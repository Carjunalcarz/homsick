/**
 * npm run unlock-user -- --username ana.cruz
 *
 * Unlock a staff account locked after 5 failed sign-ins. This is the recovery
 * path when the only Admin is locked out; Admins get an unlock button in the
 * staff pages (Story 2.5). Writes one auth.unlocked audit row (actor: system).
 */
import { parseArgs } from "node:util";
import { announceTarget, loadDotEnv, refuseDefaultDatabaseInProduction } from "./load-env";

loadDotEnv();

async function main() {
  const { values } = parseArgs({
    options: { username: { type: "string" } },
    strict: true,
  });
  if (!values.username?.trim()) throw new Error("Pass --username <username>.");

  refuseDefaultDatabaseInProduction();

  const { unlock } = await import("@/server/auth/lockout");
  const { users } = await import("@/server/auth/schema");
  const { normalizeUsername } = await import("@/server/auth/staff-rules");
  const { closeDb, getDb } = await import("@/server/db/client");
  const { getEnv } = await import("@/server/env");
  const { eq } = await import("drizzle-orm");

  announceTarget(getEnv());

  const username = normalizeUsername(values.username);
  const db = getDb();
  try {
    const user = db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.username, username))
      .get();
    if (!user) throw new Error(`No account has the username "${username}".`);

    const result = unlock(user.id, { type: "system", name: "unlock-user" }, db);
    if (result === "unlocked") console.log(`Unlocked "${user.name}" (username: ${username}).`);
    else if (result === "reset") {
      console.log(`"${user.name}" (username: ${username}) was not locked; failed attempts reset.`);
    } else if (result === "not_locked") {
      console.log(`"${user.name}" (username: ${username}) is not locked. Nothing to do.`);
    }
    else throw new Error(`No account has the username "${username}".`);
  } finally {
    closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(`unlock-user failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
