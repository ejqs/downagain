---
name: downagain
description: Working on downagain.dev - adding or fixing a tracked provider, changing the severity rubric or grades, backfilling history, and checking the poller. Use for any change to providers, adapters, classification, grading or the poll pipeline.
---

# downagain.dev

A read-only Next.js site that ranks hosting and AI providers by their own status-page history. Read `README.md` first; this is the checklist for the common changes.

## Ground rules

- Never ping a provider's website or API. Only read their official status page API (Statuspage JSON, Railway's, Heroku's). Keep the `User-Agent` and conditional requests in `src/lib/fetcher.ts`.
- Never delete incidents or updates. History is kept forever; fix data with `tier_override` + `override_note`, not deletes.
- Everyone is ranked on the same 90-day window. Deeper history only shows on provider pages.
- Tone: light humour in headings, factual in data and incident text.
- Mobile first: check every page at 390px wide with no horizontal scroll.

## Add a provider

1. Find the status page and confirm the source format by reading the live endpoint (e.g. `https://status.example.com/api/v2/summary.json`). Statuspage-compatible pages (including many incident.io pages) use `sourceKind: "statuspage"` with the page root as `sourceUrl`.
2. Add an entry to `PROVIDERS` in `src/lib/providers.ts` (category, kind, URLs, `verified` date). Add `surfaces` overrides for component names the rules in `src/lib/severity.ts` get wrong.
3. Save a real response as a fixture in `tests/fixtures/` (file name from `fixtureName()`), add an adapter test if the format is new, run `bun run test`.
4. Deploy, or locally: `bun run db:seed && bun run backfill --provider <slug>`.
5. A provider is hidden until its source answers once, so check the poll route's `failed` list after deploying.

## Change the severity rubric

1. Edit `src/lib/severity.ts` and bump `CLASSIFIER_VERSION`.
2. Update `tests/severity.test.ts` and the About page if tier meanings changed.
3. After deploying, run `bun run regrade` against production so stored incidents use the new rules. Manual overrides are kept.

## Grades

`src/lib/grading.ts` holds the weights, window and cut-offs. Change cut-offs only after looking at the real spread of points, so the board isn't all A's or all F's.

## Local development

```bash
cp .env.example .env            # point DATABASE_URL at a local Postgres
bun run db:migrate && bun run db:seed
bun run dev:sample                 # made-up incidents, localhost only; --clear removes them
STATUS_FIXTURES_DIR=tests/fixtures bun run poll vercel railway heroku   # poll from fixtures
bun run dev
```
