import { defineConfig } from "drizzle-kit";

// Schema changes only through committed migrations in drizzle/ (AD-1).
// Each module owns its tables in src/server/<module>/schema.ts.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/**/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_PATH ?? "data/dev.sqlite" },
  strict: true,
  verbose: true,
});
