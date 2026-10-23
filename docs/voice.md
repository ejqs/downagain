# downagain voice

The standing reference for every word on the site: copy, labels, empty states, metadata. Read it before writing any.

A scoreboard, not a manual. The numbers do the talking.

## Rules

1. **Say it once, short.** Labels are nouns: "Incidents", "Longest", "Admitted uptime". No sentences where a label works.
2. **Don't explain the UI.** No "tap a provider", "best value is highlighted", "pick up to three". If a control needs a sentence, fix the control.
3. **Explain on demand.** A metric that needs a definition gets a "?" hint with one line (`src/lib/glossary.ts`). The full method lives on /about. Never put an explainer paragraph under a section.
4. **Wink sparingly.** Humour goes in headings, empty states and the odd aside, at most one per screen, and the site name and "It was DNS" already spend it on most pages. Data, labels and incident text stay straight.
5. **Laugh at the situation, not the provider.** Outages are funny; the people fixing them aren't. We're on Railway, so we're fair game too.
6. **Quote providers, don't paraphrase them.** Incident titles and updates appear as posted. The one exception is Claude's short summary of a long incident, shown in place of the reason line and marked by the AI-graded tag.
7. **Numbers first.** "3 incidents", not "There were 3 incidents".
8. **No hedging stacks.** One caveat, where it matters (the "admitted" in admitted uptime), explained once on /about.

## Tells

Patterns that read as machine-written. Delete on sight.

- The two-beat deadpan: a flat statement, a full stop, then a wry tag. "All up. For now." "Nothing. Nice." Say the first part. The one kept on purpose: the footer's "Hosted on Railway. Yeah, I know." (EJ's call; rule 5).
- A question answered by the next sentence. "Running app? Watch PROD."
- A heading that is a quip instead of a noun. "Before you migrate." is "Compare".
- Reassurance and reflection: "Enjoy it", "So far", "we just add it up".

## Mechanics

- Sentence case for headings and buttons. Uppercase only for small mono pills (SEV 1, DOWN NOW).
- No exclamation marks. No em dashes. No "simply", "just", "seamless", "we believe".
- Times as "2h 14m", dates as "Oct 3". UTC unless a label says otherwise.
- Empty states get one line, and may have the wink.

## Before and after

| Before | After |
| --- | --- |
| Live status and 90-day track records for the platforms your apps run on, pulled from each provider's public status page. | Who went down, for how long, by their own admission. |
| Least reliable first, last 90 days. Tap a provider for its full history. | Last 90 days. |
| Pick up to three providers. The best value in each row is highlighted. Comparing within one category makes the most sense. | (nothing) |
| No providers in this category have reported in yet. The first poll after a deploy fills this in. | Nothing here yet. |
| All tracked services are up. Enjoy it. | All up. |
| Admitted uptime counts time not covered by a Sev 1 incident posted on its own status page. Status pages can under-report, so treat it as a best case. | Admitted uptime (?) |
| Status-page components differ between providers, so we group them into three areas you can compare anywhere. | (nothing; area names carry it) |

## Words we use

down, up, incident, outage, admitted uptime, grade, Sev 1 to Sev 4 (Lights out, Bleeding, Can't ship, Papercut), PROD and SHIP (the two area grades), postmortem, status page.
