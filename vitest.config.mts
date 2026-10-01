import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // Tests run server code directly; "server-only" only guards client bundles.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // A file's first test pays for importing the server modules (and a fresh
    // migrated SQLite file); under a full parallel run that can pass the 5 s default.
    testTimeout: 15_000,
    setupFiles: ["./src/test-support/setup.ts"],
  },
});
