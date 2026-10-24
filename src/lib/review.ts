// Runs after each poll: asks Claude to read incidents that are new or changed
// since their last review, within a monthly budget, and stores the refined grade.
// The poller always writes the rules grade first, so a skipped or failed review
// simply leaves that in place.
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { categories, componentSurfaces, incidentReviews, incidentUpdates, incidents, providers } from "@/db/schema";
import { DEFAULT_MODEL, PROMPT_VERSION, applyVerdict, isLongText, askClaude, costMicros, inputHash, parseVerdict, renderIncident } from "@/lib/ai-grade";
import { MAX_PENALTY_MINUTES, MAX_PENALTY_MINUTES_MILD, WINDOW_DAYS } from "@/lib/grading";
import { TIER_WEIGHT, classify, holdToRegion, singleRegion, type Classification, type Surface } from "@/lib/severity";

export interface ReviewSettings {
  enabled: boolean;
  model: string;
  monthlyBudgetMicros: number;
}

export function reviewSettings(env: Record<string, string | undefined> = process.env): ReviewSettings {
  const budget = Number(env.AI_MONTHLY_BUDGET_USD ?? 5);
  return {
    enabled: Boolean(env.ANTHROPIC_API_KEY) && env.AI_GRADING !== "off",
    model: env.AI_GRADING_MODEL || DEFAULT_MODEL,
    monthlyBudgetMicros: Math.round((Number.isFinite(budget) ? budget : 5) * 1_000_000),
  };
}

export interface ReviewReport {
  enabled: boolean;
  called: number;
  fromCache: number;
  failed: number;
  pendingLeft: boolean;
  stoppedBecause?: string;
  spentThisMonthUsd: number;
  changedProviders: string[];
  /** This run's fresh reads where Claude's tier differs from the rules, for the poll log. */
  disagreements: { provider: string; title: string; rules: number; claude: number; why: string }[];
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export async function spentThisMonth(database: DB, now = new Date()): Promise<number> {
  const [r] = await database
    .select({ total: sql<number>`coalesce(sum(${incidentReviews.costMicros}), 0)::int` })
    .from(incidentReviews)
    .where(gte(incidentReviews.createdAt, monthStart(now)));
  return r?.total ?? 0;
}

async function surfaceOverrides(database: DB) {
  const out = new Map<number, Map<string, Surface>>();
  for (const r of await database.select().from(componentSurfaces)) {
    if (!out.has(r.providerId)) out.set(r.providerId, new Map());
    out.get(r.providerId)!.set(r.componentName, r.surface as Surface);
  }
  return out;
}

type Row = { i: typeof incidents.$inferSelect; provider: string; slug: string; cat: string };

async function loadUpdates(database: DB, incidentId: number) {
  return database
    .select({ status: incidentUpdates.status, body: incidentUpdates.body, postedAt: incidentUpdates.postedAt })
    .from(incidentUpdates)
    .where(eq(incidentUpdates.incidentId, incidentId));
}

function rulesFor(r: Row, updates: { body: string }[], overrides: Map<number, Map<string, Surface>>): Classification {
  return classify(
    {
      title: r.i.title,
      impact: r.i.impact,
      components: r.i.components,
      worstComponentStatus: r.i.worstComponentStatus,
      regions: r.i.regions,
      updateText: updates.map((u) => u.body).join("\n"),
      categorySlug: r.cat,
    },
    overrides.get(r.i.providerId),
  );
}

function gradeColumns(c: Classification & { gradedBy?: string; scope?: string | null; summary?: string | null; recoveredAt?: Date | null }, longText = false) {
  return {
    tier: c.tier,
    areaTiers: c.areaTiers,
    surfaces: c.surfaces,
    security: c.security,
    compromise: c.compromise,
    lowConfidence: c.lowConfidence,
    reason: c.reason,
    classifierVersion: c.classifierVersion,
    gradedBy: c.gradedBy ?? "rules",
    scope: c.scope ?? null,
    summary: longText && c.summary ? c.summary : null,
    recoveredAt: c.recoveredAt ?? null,
  };
}

/** The grade to store: Claude's verdict for this exact version if we have a good one, else the rules. */
export function finalGrade(rules: Classification, verdict: unknown, regions?: string[] | null) {
  const v = verdict == null ? null : parseVerdict(verdict);
  if (!v) return { ...rules, gradedBy: "rules" as const, scope: rules.scope ?? null, summary: null, recoveredAt: null };
  const refined = applyVerdict(rules, v);
  // The rules already hold single-region incidents; Claude's grade gets the same treatment.
  if (v.data_loss) return refined;
  const held = holdToRegion(refined, regions);
  return held === refined ? held : { ...held, reason: `${held.reason} Held to Sev ${held.tier} as only ${singleRegion(regions)} was hit.` };
}

/**
 * Roughly how many penalty points the rules grade puts on the board: tier weight
 * times penalty minutes (to monitoring, capped at 72 h for Sev 1 and 24 h otherwise), zero outside the ranking
 * window. A long rules-graded incident can sink a grade on its own, so Claude
 * reads those before a pile of short recent ones.
 */
function gradeWeight(now: Date) {
  const from = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const weight = sql.join(
    Object.entries(TIER_WEIGHT).map(([t, w]) => sql`when ${Number(t)}::int then ${w}::float8`),
    sql` `,
  );
  return sql`case when ${incidents.startedAt} < ${from.toISOString()}::timestamptz then 0 else
    (case coalesce(${incidents.tierOverride}, ${incidents.tier}, 4) ${weight} else 0 end)
    * least(extract(epoch from coalesce(${incidents.monitoringAt}, ${incidents.resolvedAt}, ${now.toISOString()}::timestamptz) - ${incidents.startedAt}),
      case when coalesce(${incidents.tierOverride}, ${incidents.tier}, 4) <= 1 then ${MAX_PENALTY_MINUTES * 60}::int else ${MAX_PENALTY_MINUTES_MILD * 60}::int end)
  end`;
}

let running = false;

/**
 * Review incidents that changed since their last review, newest and still-open
 * first. At most `limit` API calls per run, and none once this month's spend
 * reaches the budget. Versions already reviewed are applied from the cache.
 */
export async function reviewPending(
  database: DB,
  opts: { limit?: number; deadlineMs?: number; now?: Date; settings?: ReviewSettings; client?: Anthropic; slugs?: string[] } = {},
): Promise<ReviewReport> {
  const settings = opts.settings ?? reviewSettings();
  const now = opts.now ?? new Date();
  const report: ReviewReport = { enabled: settings.enabled, called: 0, fromCache: 0, failed: 0, pendingLeft: false, spentThisMonthUsd: 0, changedProviders: [], disagreements: [] };
  if (!settings.enabled || running) return report;
  running = true;
  try {
    const limit = opts.limit ?? 15;
    const deadline = Date.now() + (opts.deadlineMs ?? 60_000);
    const client = opts.client ?? new Anthropic({ timeout: 20_000, maxRetries: 1 });
    let spent = await spentThisMonth(database, now);

    const pending = or(
      isNull(incidents.reviewedAt),
      sql`${incidents.updatedAt} > ${incidents.reviewedAt}`,
      sql`coalesce(${incidents.reviewedPrompt}, 0) < ${PROMPT_VERSION}`,
    );
    const rows: Row[] = await database
      .select({ i: incidents, provider: providers.name, slug: providers.slug, cat: categories.slug })
      .from(incidents)
      .innerJoin(providers, eq(providers.id, incidents.providerId))
      .innerJoin(categories, eq(categories.id, providers.categoryId))
      .where(opts.slugs?.length ? and(pending, inArray(providers.slug, opts.slugs)) : pending)
      .orderBy(sql`${incidents.resolvedAt} is null desc`, desc(gradeWeight(now)), desc(incidents.startedAt), asc(incidents.id))
      .limit(limit * 2);
    if (!rows.length) return report;

    const overrides = await surfaceOverrides(database);
    const changed = new Set<string>();

    for (const r of rows) {
      if (Date.now() > deadline) {
        report.stoppedBecause = "time";
        break;
      }
      const updates = await loadUpdates(database, r.i.id);
      const rendered = renderIncident({
        provider: r.provider,
        category: r.cat,
        title: r.i.title,
        impact: r.i.impact,
        status: r.i.status,
        startedAt: r.i.startedAt,
        resolvedAt: r.i.resolvedAt,
        components: r.i.components,
        worstComponentStatus: r.i.worstComponentStatus,
        regions: r.i.regions,
        updates,
      });
      const hash = inputHash(rendered, settings.model);
      const rules = rulesFor(r, updates, overrides);

      const [cached] = await database
        .select()
        .from(incidentReviews)
        .where(and(eq(incidentReviews.incidentId, r.i.id), eq(incidentReviews.inputHash, hash)));

      let verdict: unknown = cached?.verdict ?? null;
      if (cached) {
        report.fromCache++;
      } else {
        if (report.called >= limit || spent >= settings.monthlyBudgetMicros) {
          // Out of calls for this run or this month; the rules grade stands until then.
          report.stoppedBecause = report.called >= limit ? "batch limit" : "monthly budget";
          report.pendingLeft = true;
          break;
        }
        const out = await askClaude(client, settings.model, rendered);
        report.called++;
        const cost = costMicros(settings.model, out.usage);
        spent += cost;
        if (!out.ok && out.retry) {
          // API trouble: leave this incident pending and try again next poll.
          report.failed++;
          report.stoppedBecause = `api: ${out.error}`.slice(0, 200);
          report.pendingLeft = true;
          break;
        }
        verdict = out.ok ? out.verdict : null;
        if (!out.ok) report.failed++;
        const grade = finalGrade(rules, verdict, r.i.regions);
        if (grade.gradedBy === "claude" && grade.tier !== rules.tier) {
          report.disagreements.push({ provider: r.slug, title: r.i.title.slice(0, 80), rules: rules.tier, claude: grade.tier, why: grade.reason ?? "" });
        }
        await database
          .insert(incidentReviews)
          .values({
            incidentId: r.i.id,
            inputHash: hash,
            model: settings.model,
            promptVersion: PROMPT_VERSION,
            verdict,
            error: out.ok ? null : out.error,
            rulesTier: rules.tier,
            rulesReason: rules.reason,
            input: rendered,
            rawOutput: out.raw ?? null,
            tier: grade.tier,
            inputTokens: out.usage.input_tokens + (out.usage.cache_creation_input_tokens ?? 0) + (out.usage.cache_read_input_tokens ?? 0),
            outputTokens: out.usage.output_tokens,
            costMicros: cost,
            createdAt: now,
          })
          .onConflictDoNothing();
      }

      const grade = finalGrade(rules, verdict, r.i.regions);
      // Only touch the row if the poller hasn't changed it again since we read it.
      // (JS dates drop Postgres's microseconds, hence the 1 ms window.)
      await database
        .update(incidents)
        .set({ ...gradeColumns(grade, isLongText(updates)), reviewedAt: sql`${incidents.updatedAt}`, reviewedHash: hash, reviewedPrompt: PROMPT_VERSION })
        .where(and(eq(incidents.id, r.i.id), lt(incidents.updatedAt, new Date(r.i.updatedAt.getTime() + 1))));
      if (grade.tier !== r.i.tier || grade.reason !== r.i.reason || grade.gradedBy !== r.i.gradedBy) changed.add(r.slug);
    }

    report.pendingLeft ||= rows.length === limit * 2;
    report.spentThisMonthUsd = spent / 1_000_000;
    report.changedProviders = [...changed];
    return report;
  } finally {
    running = false;
  }
}

/** For regrade: the stored verdict for an incident's last reviewed version, if any. */
export async function storedVerdict(database: DB, incidentId: number, hash: string | null): Promise<unknown> {
  if (!hash) return null;
  const [r] = await database
    .select({ verdict: incidentReviews.verdict })
    .from(incidentReviews)
    .where(and(eq(incidentReviews.incidentId, incidentId), eq(incidentReviews.inputHash, hash)));
  return r?.verdict ?? null;
}

export { gradeColumns };
