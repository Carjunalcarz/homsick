/**
 * npm run db:migrate: back up an existing database to
 * BACKUP_DIR/pre-migrate-<UTC timestamp>.sqlite, then apply the committed
 * drizzle/ migrations to DATABASE_PATH (`migrateWithBackup`). A new or empty
 * database has no backup. When the backup fails, nothing is migrated and the
 * command exits 1.
 */
import { announceTarget, loadDotEnv, refuseDefaultDatabaseInProduction } from "./load-env";

loadDotEnv();

async function main() {
  refuseDefaultDatabaseInProduction();
  const { getEnv } = await import("@/server/env");
  const { closeDb, getDb } = await import("@/server/db/client");
  const { migrateWithBackup } = await import("@/server/db/backup");

  const env = getEnv();
  announceTarget(env);
  try {
    const backup = migrateWithBackup(getDb(), env.BACKUP_DIR);
    console.log(backup ? `Pre-migration backup: ${backup.file}` : "New or empty database: no pre-migration backup.");
  } finally {
    closeDb();
  }
  console.log("Migrations applied.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
