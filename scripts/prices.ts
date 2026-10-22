// Lists every hand-curated price, oldest check first, so a monthly refresh is one
// pass down the list: open the source, fix src/lib/pricing.ts, bump `checked`.
import { PRICES, STALE_AFTER_DAYS, checkedMs, fmtUsd, isStale, monthlyUsd } from "../src/lib/pricing";

const DAY = 86_400_000;
const rows = Object.entries(PRICES).sort((a, b) => checkedMs(a[1]) - checkedMs(b[1]));
for (const [slug, p] of rows) {
  const age = Math.floor((Date.now() - checkedMs(p)) / DAY);
  const usd = monthlyUsd(p);
  console.log(`${isStale(p) ? "STALE" : "ok   "}  ${slug.padEnd(14)} ${String(age).padStart(4)}d  ${(usd == null ? "–" : fmtUsd(usd)).padStart(8)}  ${p.plan}`);
  console.log(`       ${p.source}`);
}
const stale = rows.filter(([, p]) => isStale(p)).length;
console.log(`\n${stale} of ${rows.length} older than ${STALE_AFTER_DAYS} days.`);
