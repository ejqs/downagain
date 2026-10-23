import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const status = pgEnum("status", [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
  "unknown",
]);
export const sourceKind = pgEnum("source_kind", ["statuspage", "railway", "heroku", "gcp", "aws", "azure"]);
export const impact = pgEnum("impact", ["none", "minor", "major", "critical"]);

export type Status = (typeof status.enumValues)[number];
export type SourceKind = (typeof sourceKind.enumValues)[number];
export type Impact = (typeof impact.enumValues)[number];

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(), // "hosting", "ai"
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(), // hosting = 1
  enabled: boolean("enabled").notNull().default(true),
});

export const providers = pgTable("providers", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(), // "vercel"
  name: text("name").notNull(),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id),
  kind: text("kind"), // "PaaS", "LLM API"
  sortOrder: integer("sort_order").notNull().default(100),
  historyFrom: timestamp("history_from", { withTimezone: true }), // oldest incident we hold
  homepageUrl: text("homepage_url"),
  statusPageUrl: text("status_page_url").notNull(), // the human page we link to
  sourceKind: sourceKind("source_kind").notNull(),
  sourceUrl: text("source_url").notNull(), // base URL the adapter reads
  enabled: boolean("enabled").notNull().default(true),
});

// one row per provider, overwritten each poll
export const providerStatus = pgTable("provider_status", {
  providerId: integer("provider_id")
    .primaryKey()
    .references(() => providers.id),
  status: status("status").notNull(),
  since: timestamp("since", { withTimezone: true }).notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull(),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }), // last successful fetch
  fetchError: text("fetch_error"),
  stateHash: text("state_hash"), // hash of the normalized state, for change detection
  etags: jsonb("etags").$type<Record<string, string>>(),
  components: jsonb("components").$type<{ name: string; status: Status; group?: string }[]>(),
});

// append-only, written only on transitions
export const statusChanges = pgTable(
  "status_changes",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id),
    status: status("status").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("status_changes_provider").on(t.providerId, t.changedAt)],
);

export const incidents = pgTable(
  "incidents",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    impact: impact("impact").notNull(),
    status: text("status").notNull(), // investigating, identified, monitoring, resolved, postmortem
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    monitoringAt: timestamp("monitoring_at", { withTimezone: true }), // first "monitoring" update
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    // Claude's read of when service was back to normal, if earlier than the provider closing it
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),
    url: text("url"),
    components: text("components").array().notNull().default([]),
    regions: text("regions").array(), // cloud regions named by the provider; null = global or not stated
    worstComponentStatus: status("worst_component_status"),
    postmortem: boolean("postmortem").notNull().default(false),
    raw: jsonb("raw"),
    origin: text("origin").notNull(), // "backfill" | "live"
    // our own grading, see src/lib/severity.ts
    tier: integer("tier"), // 1 = Lights out … 4 = Papercut, 0 = not counted
    areaTiers: jsonb("area_tiers").$type<Partial<Record<"production" | "shipping" | "dashboard", number>>>(),
    surfaces: text("surfaces").array(), // ["serving", "ship"]
    security: boolean("security").notNull().default(false),
    lowConfidence: boolean("low_confidence").notNull().default(false),
    reason: text("reason"), // "Sev 1 because Edge Network had a major outage"
    tierOverride: integer("tier_override"),
    overrideNote: text("override_note"),
    classifierVersion: integer("classifier_version"),
    gradedBy: text("graded_by").notNull().default("rules"), // "rules" | "claude"
    scope: text("scope"), // Claude's read: global | regional | subset | unclear
    summary: text("summary"), // Claude's plain recap, only for long provider text
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }), // last Claude review; pending while updatedAt is newer
    reviewedHash: text("reviewed_hash"), // input hash of that review, see incident_reviews
    reviewedPrompt: integer("reviewed_prompt"), // PROMPT_VERSION of that review; older ones are read again
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("incidents_provider_external").on(t.providerId, t.externalId),
    index("incidents_started").on(t.startedAt),
  ],
);

// every posted update ("Investigating", "Fix deployed", ...), kept forever
export const incidentUpdates = pgTable(
  "incident_updates",
  {
    id: serial("id").primaryKey(),
    incidentId: integer("incident_id")
      .notNull()
      .references(() => incidents.id),
    externalId: text("external_id").notNull(),
    status: text("status").notNull(),
    body: text("body").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("updates_incident_external").on(t.incidentId, t.externalId)],
);

// raw status documents, stored only when their hash changes
export const rawSnapshots = pgTable(
  "raw_snapshots",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    hash: text("hash").notNull(),
    body: jsonb("body").notNull(),
  },
  (t) => [index("raw_snapshots_provider").on(t.providerId, t.fetchedAt)],
);

// component name → surface, for names the regex rules miss
export const componentSurfaces = pgTable(
  "component_surfaces",
  {
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id),
    componentName: text("component_name").notNull(),
    surface: text("surface").notNull(), // serving | data | ship | manage | peripheral
  },
  (t) => [primaryKey({ columns: [t.providerId, t.componentName] })],
);

// One Claude read per incident version (input hash), kept forever. A review that
// failed has no verdict and keeps the rules grade until the incident changes.
export const incidentReviews = pgTable(
  "incident_reviews",
  {
    id: serial("id").primaryKey(),
    incidentId: integer("incident_id")
      .notNull()
      .references(() => incidents.id),
    inputHash: text("input_hash").notNull(),
    model: text("model").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    verdict: jsonb("verdict"),
    error: text("error"),
    rulesTier: integer("rules_tier"), // what the rules said, for spotting disagreements
    rulesReason: text("rules_reason"),
    input: text("input"), // exactly what Claude read (the rendered incident)
    rawOutput: text("raw_output"), // exactly what Claude answered, before parsing
    tier: integer("tier"), // what we stored after applying the verdict
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicros: integer("cost_micros").notNull().default(0), // millionths of a US dollar
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reviews_incident_hash").on(t.incidentId, t.inputHash), index("reviews_created").on(t.createdAt)],
);
