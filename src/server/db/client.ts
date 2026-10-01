import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getEnv } from "@/server/env";
import * as schema from "./schema-index";

export type Schema = typeof schema;
export type Db = BetterSQLite3Database<Schema> & { $client: Database.Database };

/** Open a SQLite file with the AD-1 pragmas. Creates its folder if needed. */
export function openDatabase(filePath: string): Db {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  registerFunctions(sqlite);
  return drizzle(sqlite, { schema });
}

/**
 * App SQL functions, on every connection (the app's and createTestDb()'s,
 * which both open through openDatabase). SQLite's own lower() only folds
 * ASCII, so "PEÑA" wouldn't match "peña".
 */
function registerFunctions(sqlite: Database.Database) {
  sqlite.function("unicode_lower", { deterministic: true }, (value: unknown) =>
    typeof value === "string" ? value.toLowerCase() : value,
  );
}

// Kept on globalThis so dev hot reloads reuse one connection.
const globalForDb = globalThis as unknown as { __opdDb?: Db };

/**
 * The app's one database connection, opened on first use (never at import,
 * so builds and prerendering don't touch the file). Callers must already be
 * at request time (requireStaff(), requireDisplayDevice() or connection()).
 */
export function getDb(): Db {
  globalForDb.__opdDb ??= openDatabase(getEnv().DATABASE_PATH);
  return globalForDb.__opdDb;
}

/** Close the shared connection (tests and scripts). */
export function closeDb() {
  globalForDb.__opdDb?.$client.close();
  globalForDb.__opdDb = undefined;
}
