// Poll every provider once, straight against the database. Handy locally; in
// production the cron service calls the web route instead, so the web
// process's cache gets revalidated.
import { closeDb, db } from "@/db";
import { pollAll } from "@/lib/poller";

const slugs = process.argv.slice(2);
const results = await pollAll(db(), { slugs });
console.table(results.map(({ slug, ok, changed, status, newIncidents, updatedIncidents, error }) => ({ slug, ok, changed, status, newIncidents, updatedIncidents, error })));
await closeDb();
