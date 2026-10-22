// Backfill: pull whatever history each status API exposes (about the last 50
// incidents on Statuspage) and mark it origin "backfill".
//   bun run backfill                     all providers
//   bun run backfill --provider vercel   one provider
// Then hit the web's poll route (or wait for the next cron run) so cached pages refresh.
import { closeDb, db } from "@/db";
import { pollAll } from "@/lib/poller";
import { seed } from "@/lib/seed";

const args = process.argv.slice(2);
const slugs: string[] = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--provider" && args[i + 1]) slugs.push(args[++i]);

const database = db();
await seed(database);
const results = await pollAll(database, { slugs, origin: "backfill" });
console.table(results.map(({ slug, ok, status, newIncidents, error }) => ({ slug, ok, status, newIncidents, error })));
await closeDb();
