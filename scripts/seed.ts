import { closeDb, db } from "@/db";
import { seed } from "@/lib/seed";

const r = await seed(db());
console.log(`Seeded ${r.categories} categories and ${r.providers} providers`);
await closeDb();
