import fs from "node:fs";
import path from "node:path";

/** Load `.env` into process.env for CLI scripts (Next.js does this for the app). */
export function loadDotEnv(file = ".env") {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

/** In production, never fall back to a default database file. */
export function refuseDefaultDatabaseInProduction() {
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_PATH?.trim()) {
    throw new Error("NODE_ENV=production but DATABASE_PATH is not set. Refusing to use a default database.");
  }
}

/** Say which database a script is about to write, before it writes anything. */
export function announceTarget(env: { NODE_ENV: string; DATABASE_PATH: string }) {
  console.log(`Mode: ${env.NODE_ENV}. Database: ${path.resolve(env.DATABASE_PATH)}`);
}
