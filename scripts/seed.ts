import { closeDb, db } from "@/db";
import { importArchives } from "@/lib/archive";
import { seed } from "@/lib/seed";

const r = await seed(db());
console.log(`Seeded ${r.categories} categories and ${r.providers} providers`);
const a = await importArchives(db());
console.log(`Archived incidents: ${a.inserted} new, ${a.updated} updated`);
await closeDb();
