import { closeDb, db } from "@/db";
import { regradeAll } from "@/lib/regrade";

console.log(`Regraded ${await regradeAll(db())} incidents`);
await closeDb();
