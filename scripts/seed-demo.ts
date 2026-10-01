/**
 * npm run db:seed:demo: add 42 fictional demo patients to the database (run
 * `npm run db:migrate` first). Development and demos only: it refuses when
 * NODE_ENV=production, and refuses a second run (it finds its own patients
 * by their `created_by` marker). It writes no audit rows.
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import { announceTarget, loadDotEnv } from "./load-env";

loadDotEnv();

const MIGRATE_FIRST = "Run npm run db:migrate first.";

/** Whether the database file exists and has the `patients` table. Opens read-only: never creates a file. */
function hasPatientsTable(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const sqlite = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return sqlite.prepare("select 1 from sqlite_master where type = 'table' and name = 'patients'").get() !== undefined;
  } finally {
    sqlite.close();
  }
}

async function main() {
  // Imports only: nothing is opened or written before this check.
  const { DEMO_PRODUCTION_MESSAGE, seedDemoPatients } = await import("@/server/patients/demo-seed");
  if (process.env.NODE_ENV === "production") {
    console.error(DEMO_PRODUCTION_MESSAGE);
    process.exit(1);
  }
  const { getEnv } = await import("@/server/env");
  const { closeDb, getDb } = await import("@/server/db/client");

  const env = getEnv();
  announceTarget(env);
  if (!hasPatientsTable(env.DATABASE_PATH)) {
    console.error(MIGRATE_FIRST);
    process.exit(1);
  }
  try {
    const added = seedDemoPatients(getDb());
    console.log(`Added ${added} fictional demo patients. No audit rows were written (demo data is not a staff action).`);
  } finally {
    closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(`db:seed:demo failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
