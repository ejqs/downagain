# downagain.dev

**Is it down again?** Live status and 90-day track records for the hosting platforms, clouds and AI APIs your apps run on, pulled from each provider's own public status page.

- A **down right now** banner on every page.
- A leaderboard per category (Hosting first, then AI APIs, Cloud and Databases), graded A+ to F on the same 90-day window for everyone.
- Provider pages with admitted uptime for 30d / 90d / 1y, PROD and SHIP area grades, severity mix, 12-month trend, when incidents start, what breaks, how the provider communicates, full incident history, peers and a README badge.
- An incident feed, a head-to-head compare page and a public `/api/status.json`.
- Share cards per provider (`/p/<slug>/opengraph-image`) and for the site, drawn live from the same data.

We never ping provider sites. We only read their official status page APIs, every 5 minutes, politely.

## How it works

```
Railway cron (*/5) ──POST──▶ web: /api/cron/poll ──GET (ETag)──▶ provider status APIs
                                   │ write only on change
                                   ▼
                               Postgres ◀── cache miss only ── Next.js data cache ◀── visitors
                                   └──── revalidateTag("status") on change ────┘
```

- **Adapters** (`src/lib/adapters/`) turn Atlassian Statuspage JSON (most providers, including incident.io pages with the compatible API), Railway's status API, Heroku's status API, Google Cloud's `incidents.json`, the AWS Health Dashboard feeds and the Azure status RSS into one shape.
- **Poller** (`src/lib/poller.ts`) diffs each provider against what's stored, upserts incidents and their updates, records status transitions and raw documents when they change, and reports which providers changed. Nothing is ever deleted.
- **Severity** (`src/lib/severity.ts`) is our own rubric: Sev 1 Lights out, Sev 2 Bleeding, Sev 3 Can't ship, Sev 4 Papercut. Graded by impact: PROD when end users are hit, SHIP when you can't deploy, build or manage (dashboard, auth and billing outages included); papercuts only count overall. Security bumps a tier (floor Sev 2); data loss is always Sev 1. `tier_override` wins.
- **Claude grading** (`src/lib/ai-grade.ts`, `src/lib/review.ts`): after each poll, Claude Haiku 5.5 reads new or changed incidents (title, components and every update) and refines the rule grade: tier per surface, blast radius (global, regional, subset), security, data loss. One review per incident version is stored in `incident_reviews` and reused. At most 15 calls per poll and `AI_MONTHLY_BUDGET_USD` (default $5) per month; with no key, no budget or an API error the rules grade stands.
- **Grades** (`src/lib/grading.ts`): penalty points = tier weight × minutes until the provider says "monitoring", over a rolling 90 days. "Admitted uptime" counts only Sev 1 time the provider posted.
- **Caching** (`src/lib/data.ts`): every read goes through `unstable_cache` tagged `status` / `provider:<slug>`. The poll route revalidates those tags only when something changed, so page traffic doesn't reach Postgres. A 10-minute safety net catches anything missed.
- A provider stays hidden until its status source has answered once, so a wrong endpoint never shows up as an outage.

## Stack

Next.js 16 (App Router), Drizzle ORM, Postgres, all on Railway. Umami Cloud for analytics (its standard script, production only).

## Local development

Needs Node 22+, bun run and a Postgres.

```bash
cp .env.example .env          # set DATABASE_URL
bun install
bun run db:migrate && bun run db:seed
bun run dev:sample               # optional: made-up incidents (localhost only; --clear removes them)
bun run dev
```

Useful scripts:

| Command | What it does |
|---|---|
| `bun run poll [slug…]` | Poll providers once, straight into the database |
| `STATUS_FIXTURES_DIR=tests/fixtures bun run poll vercel railway heroku` | Same, reading saved fixtures instead of the network |
| `bun run backfill [--provider slug]` | Seed, then pull whatever history each status API exposes (marked `origin = backfill`) |
| `bun run regrade` | Re-run the classifier over every stored incident (polls also do this on their own after a `CLASSIFIER_VERSION` bump) |
| `bun run ai-review [--limit 200] [--provider slug]` | Have Claude grade a bigger batch of pending incidents than one poll does |
| `bun run test` / `bun run lint` | Unit and integration tests / typecheck. Needs no database: poller and route tests run on an in-process Postgres (PGlite) with the real migrations |
| `bun run e2e:prepare && bun run build && bun run test:e2e` | Playwright smoke tests (desktop and 390px mobile) against a production build. Needs a local `DATABASE_URL`; fills it with fixtures and sample data |
| `bun run db:generate` | New migration after editing `src/db/schema.ts` |
| `bun scripts/make-icons.ts` | Re-render the favicon and app icons after editing `assets/icon.svg` |

## Deploying on Railway

`.railway/railway.ts` describes the project: `downagain` (the web service: Next.js, runs `bun run db:migrate && bun run db:seed` before each deploy, healthcheck `/api/health`), `Postgres`, and `poller` (cron `*/5 * * * *`, runs `bun scripts/cron-trigger.mjs`, which POSTs to web over the private network and exits).

The live project ("Down Again", region asia-southeast1) is set up this way already. To recreate it:

1. `railway link` to the project, then `railway config plan` and read the plan before `railway config apply`.
2. Set `CRON_SECRET` on `downagain` to a long random string. The poller reads it by reference. Set `ANTHROPIC_API_KEY` on `downagain` to turn on Claude grading.
3. On a fresh database, run the history backfill once, either with `railway run --service downagain bun run backfill` or by setting the pre-deploy command to `bun run db:migrate && bun run backfill` for one deploy.
4. `downagain.dev` is attached to the web service; DNS lives in Cloudflare (set up with Railway's one-click Cloudflare flow).

Environment variables are listed in `.env.example`.

## Adding a provider

See `.claude/skills/downagain/SKILL.md`. In short: confirm the status API format, add an entry to `src/lib/providers.ts`, save a fixture and test, deploy, backfill.

## Not yet built

- The status-page history crawler for incidents older than what the APIs return.
- Dev tools and other categories.
- Azure's incident history: its RSS only lists open incidents, so older ones need the history crawler.
- Alerts by email.
- Share-card images.

If this is useful to you, [buy me a coffee](https://buymeacoffee.com/ejqs).
