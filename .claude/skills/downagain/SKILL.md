---
name: downagain
description: Working on downagain.dev - adding or fixing a tracked provider, changing the severity rubric or grades, backfilling history, and checking the poller. Use for any change to providers, adapters, classification, grading or the poll pipeline.
---

# downagain.dev

A read-only Next.js site that ranks hosting, cloud and AI providers by their own status-page history. Read `README.md` first; this is the checklist for the common changes.

## Ground rules

- Never ping a provider's website or API. Only read their official status page API (Statuspage JSON, Railway's, Heroku's). Keep the `User-Agent` and conditional requests in `src/lib/fetcher.ts`.
- Never delete incidents or updates. History is kept forever; fix data with `tier_override` + `override_note`, not deletes.
- Everyone is ranked on the same 90-day window. Deeper history only shows on provider pages.
- Tone: light humour in headings, factual in data and incident text.
- Mobile first: check every page at 390px wide with no horizontal scroll.

## Add a provider

1. Find the status page and confirm the source format by reading the live endpoint (e.g. `https://status.example.com/api/v2/summary.json`). Statuspage-compatible pages (including many incident.io pages) use `sourceKind: "statuspage"` with the page root as `sourceUrl`. The big clouds have their own adapters (`gcp`, `aws`, `azure`); a cloud adapter should fill `regions` on each incident so a one-region incident is held to Sev 2 (`holdToRegion` in `severity.ts`).
2. Add an entry to `PROVIDERS` in `src/lib/providers.ts` (category, kind, URLs, `verified` date). Add `surfaces` overrides for component names the rules in `src/lib/severity.ts` get wrong.
3. Save a real response as a fixture in `tests/fixtures/` (file name from `fixtureName()`), add an adapter test if the format is new, run `bun run test`.
4. Deploy, or locally: `bun run db:seed && bun run backfill --provider <slug>`.
5. A provider is hidden until its source answers once, so check the poll route's `failed` list after deploying.

## Railway history

Railway's API (`api.railwaystatus.com/status`) only lists open incidents, and status.railway.com returns 403 to scripts. Past incidents live in `src/lib/archive/railway.json`, read by hand from status.railway.com/historical, and `bun run db:seed` (the preDeploy step) imports them idempotently. To extend it, add entries in the same shape; never re-import an incident the live poller already holds.

## Change the severity rubric

1. Edit `src/lib/severity.ts` and bump `CLASSIFIER_VERSION`.
2. Update `tests/severity.test.ts` and the About page if tier meanings changed.
3. If the change affects how Claude should judge incidents, update `SYSTEM_PROMPT` in `src/lib/ai-grade.ts` to match and bump `PROMPT_VERSION` (every incident is then read again, which costs budget).
4. Deploy. The next polls regrade stored incidents 500 at a time and keep Claude's verdicts where the incident hasn't changed. Manual overrides are kept.

## Claude grading

- Off unless `ANTHROPIC_API_KEY` is set on the web service; `AI_GRADING=off` is the kill switch. Never commit the key.
- Budget: `AI_MONTHLY_BUDGET_USD` (default 5), at most 15 calls per poll. Spend is summed from `incident_reviews.cost_micros`.
- To see where Claude disagreed with the rules: `select incident_id, rules_tier, tier, verdict->>'rationale' from incident_reviews where rules_tier <> tier;`

## Grades

`src/lib/grading.ts` holds the weights, window and cut-offs. Change cut-offs only after looking at the real spread of points, so the board isn't all A's or all F's.

## Prices (cost and "best value")

Prices are the one hand-curated dataset: `PRICES` and `WORKLOADS` in `src/lib/pricing.ts`, one reference workload per category, priced from each provider's official pricing page.

1. `bun run prices` lists entries oldest-checked first with their source links. Re-check monthly; the site flags anything older than `STALE_AFTER_DAYS` (90).
2. Edit the `lines` so they add up to the monthly total, keep any assumption in `note` (and `estimate: true` if usage-billed), set `checked` to today.
3. A new provider needs a `PRICES` entry (the test enforces it). With no like-for-like price, use `lines: []` and explain why in `note`.
4. Don't blend price and grade into one score. "Best value" is the frontier: nobody else is cheaper-or-equal with a better-or-equal grade.

## Local development

```bash
cp .env.example .env            # point DATABASE_URL at a local Postgres
bun run db:migrate && bun run db:seed
bun run dev:sample                 # made-up incidents, localhost only; --clear removes them
STATUS_FIXTURES_DIR=tests/fixtures bun run poll vercel railway heroku   # poll from fixtures
bun run dev
```

## Tests

- `bun run test`: adapters (fixtures in `tests/fixtures/`), severity, grading, views, the poller (write-on-change, unknown after 15 min, vanished incidents, overrides kept) and the API routes (auth, which tags get revalidated). Poller and route tests use `tests/helpers/db.ts`, an in-process PGlite with the real migrations, so no Postgres is needed. To simulate a provider changing, copy fixtures with `fixtureDir()` and `edit()` them between polls.
- `bun run test:e2e`: Playwright smoke tests in `e2e/` on desktop and 390px mobile: every page renders, no console errors, no sideways scroll, banner and 404s. Run `bun run e2e:prepare` (local DB only) and `bun run build` first.
- CI runs both on every PR and push to main. A bug in the poller or rubric gets a test that fails first.
