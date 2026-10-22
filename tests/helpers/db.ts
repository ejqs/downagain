// An in-process Postgres (PGlite) with the real migrations applied, so poller and
// route tests run against the same schema as production without a server.
import { mkdtemp, cp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { seed } from "@/lib/seed";

export const FIXTURES = path.join(import.meta.dirname, "..", "fixtures");

export async function testDb(opts: { seeded?: boolean } = {}) {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, { migrationsFolder: path.join(import.meta.dirname, "..", "..", "drizzle") });
  // Same query builder, different driver; the app code only uses the shared PgDatabase API.
  const database = pg as unknown as DB;
  if (opts.seeded !== false) await seed(database);
  return { database, close: () => client.close() };
}

/** A writable copy of tests/fixtures; point STATUS_FIXTURES_DIR at it and edit files to simulate a provider changing. */
export async function fixtureDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "downagain-fixtures-"));
  await cp(FIXTURES, dir, { recursive: true });
  return {
    dir,
    async edit<T>(file: string, fn: (json: T) => T | void) {
      const p = path.join(dir, file);
      const json = JSON.parse(await readFile(p, "utf8")) as T;
      await writeFile(p, JSON.stringify(fn(json) ?? json));
    },
  };
}
