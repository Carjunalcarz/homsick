import "server-only";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./client";

/** The committed drizzle-kit migrations (AD-1). */
export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Apply every pending migration in `drizzle/` to `db`. */
export function runMigrations(db: Db, migrationsFolder = MIGRATIONS_FOLDER) {
  migrate(db, { migrationsFolder });
}
