// Ask Claude to grade incidents that are new or changed since their last review,
// in one bigger batch than the cron run allows (it does 15 per poll). Stays inside
// AI_MONTHLY_BUDGET_USD and needs ANTHROPIC_API_KEY.
//   bun run ai-review                       up to 200 incidents
//   bun run ai-review --limit 50 --provider vercel
// Afterwards hit the web's poll route with ?revalidate so cached pages refresh.
import { closeDb, db } from "@/db";
import { reviewPending, reviewSettings } from "@/lib/review";

const args = process.argv.slice(2);
const slugs: string[] = [];
let limit = 200;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--provider" && args[i + 1]) slugs.push(args[++i]);
  else if (args[i] === "--limit" && args[i + 1]) limit = Number(args[++i]);
}

const settings = reviewSettings();
if (!settings.enabled) {
  console.error("AI grading is off: set ANTHROPIC_API_KEY (and leave AI_GRADING unset or not 'off').");
  process.exit(1);
}
const report = await reviewPending(db(), { limit, slugs, deadlineMs: 30 * 60_000, settings });
console.log(report);
await closeDb();
