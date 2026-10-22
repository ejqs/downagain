import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: DB; __sql?: postgres.Sql };

/** Lazily connect so `next build` never needs DATABASE_URL. */
export function db(): DB {
  if (!globalForDb.__db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__sql = postgres(url, { max: 5, idle_timeout: 30 });
    globalForDb.__db = drizzle(globalForDb.__sql, { schema });
  }
  return globalForDb.__db;
}

export async function closeDb() {
  await globalForDb.__sql?.end({ timeout: 5 });
  globalForDb.__db = undefined;
  globalForDb.__sql = undefined;
}

export { schema };
