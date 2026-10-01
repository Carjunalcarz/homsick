/**
 * npm run create-admin: create an Admin account from the command line. There
 * is no default password; this is how the first Admin comes to exist.
 *
 * Interactive:      npm run create-admin
 * Non-interactive:  OPD_ADMIN_PASSWORD=... npm run create-admin -- --name "Ana Cruz" --username ana.cruz
 * (--password also works, but it ends up in shell history and the process list.)
 */
import { parseArgs } from "node:util";
import { announceTarget, loadDotEnv, refuseDefaultDatabaseInProduction } from "./load-env";
import { PromptReader } from "./prompt";

loadDotEnv();

const NAMES_EOF = "Input ended; pass --name and --username";
const PASSWORD_EOF = "Input ended; set OPD_ADMIN_PASSWORD or type the password at the prompt";

async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      username: { type: "string" },
      password: { type: "string" },
    },
    strict: true,
  });

  refuseDefaultDatabaseInProduction();

  const { AuditAction } = await import("@/server/audit/schema");
  const { getAuth } = await import("@/server/auth/auth");
  const { accounts, users } = await import("@/server/auth/schema");
  const { normalizeUsername, validateFullName, validatePassword, validateUsername } = await import(
    "@/server/auth/staff-rules"
  );
  const { closeDb, getDb } = await import("@/server/db/client");
  const { withCommandTx } = await import("@/server/db/tx");
  const { getEnv } = await import("@/server/env");
  const { eq } = await import("drizzle-orm");

  announceTarget(getEnv());

  const prompts = new PromptReader();
  const name = (values.name ?? (await prompts.question("Full name: ", { eofMessage: NAMES_EOF }))).trim();
  const nameError = validateFullName(name);
  if (nameError) throw new Error(nameError);

  const username = normalizeUsername(
    values.username ?? (await prompts.question("Username: ", { eofMessage: NAMES_EOF })),
  );
  const usernameError = validateUsername(username);
  if (usernameError) throw new Error(usernameError);

  const db = getDb();
  const existing = db.select({ id: users.id }).from(users).where(eq(users.username, username)).get();
  if (existing) throw new Error(`The username "${username}" already exists.`);

  let password = values.password ?? process.env.OPD_ADMIN_PASSWORD;
  if (password === undefined || password === "") {
    password = await prompts.question("Password: ", { hidden: true, eofMessage: PASSWORD_EOF });
    const again = await prompts.question("Repeat password: ", { hidden: true, eofMessage: PASSWORD_EOF });
    if (password !== again) throw new Error("The passwords don't match.");
  }
  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(passwordError);

  const { user } = await getAuth().api.createUser({
    body: {
      name,
      // Better Auth needs an email; staff sign in by username only.
      email: `${username}@staff.opd.invalid`,
      password,
      role: "admin",
      data: { username, displayUsername: username },
    },
  });

  try {
    withCommandTx({ type: "system", name: "create-admin" }, AuditAction.AdminCreated, (_tx, audit) => {
      audit({ entity: "user", entityId: user.id, changes: { name, username, role: "admin" } });
    });
  } catch (error) {
    // Better Auth wrote the user in its own transaction; without its audit
    // row the account must not exist.
    db.transaction((tx) => {
      tx.delete(accounts).where(eq(accounts.userId, user.id)).run();
      tx.delete(users).where(eq(users.id, user.id)).run();
    });
    throw new Error(
      `Could not write the admin.created audit row, so the account "${username}" was removed. ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  closeDb();
  console.log(`Created Admin "${name}" (username: ${username}).`);
}

main().catch((error: unknown) => {
  const message =
    error && typeof error === "object" && "body" in error
      ? ((error as { body?: { message?: string } }).body?.message ?? String(error))
      : error instanceof Error
        ? error.message
        : String(error);
  console.error(`create-admin failed: ${message}`);
  process.exit(1);
});
