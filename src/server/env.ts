import "server-only";
import { z } from "zod";

/**
 * The `.env` contract (architecture, Operations). In production every value is
 * required and the app refuses to start without it; in development and tests
 * the paths fall back to local defaults.
 */
const nodeEnv = z.enum(["development", "test", "production"]).default("development");

const required = z.string().trim().min(1, "is required");

const productionSchema = z.object({
  NODE_ENV: z.literal("production"),
  DATABASE_PATH: required,
  BACKUP_DIR: required,
  BETTER_AUTH_SECRET: required.min(32, "must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
});

const developmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test"]),
  DATABASE_PATH: required.default("data/dev.sqlite"),
  BACKUP_DIR: required.default("data/backups"),
  BETTER_AUTH_SECRET: required.min(32, "must be at least 32 characters").optional(),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
});

export type Env = {
  NODE_ENV: "development" | "test" | "production";
  DATABASE_PATH: string;
  BACKUP_DIR: string;
  /** Always set in production; Better Auth uses its dev secret when unset elsewhere. */
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL: string;
};

/** Empty strings count as missing, as they do in a half-filled `.env`. */
function blankToUndefined(source: Record<string, string | undefined>) {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value === undefined || value.trim() === "" ? undefined : value;
  }
  return out;
}

/** Parse an environment. Throws a message naming every bad key (never the values). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const input = blankToUndefined(source);
  const mode = nodeEnv.safeParse(input.NODE_ENV);
  if (!mode.success) {
    throw new Error(`Invalid environment: NODE_ENV must be development, test or production`);
  }
  const schema = mode.data === "production" ? productionSchema : developmentSchema;
  const parsed = schema.safeParse({ ...input, NODE_ENV: mode.data });
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"} ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment (${mode.data}): ${problems}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

/** The parsed process environment, read once. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Tests only: forget the cached environment. */
export function resetEnvForTests() {
  cached = undefined;
}
