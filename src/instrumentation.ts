/**
 * Runs once when the Next.js server starts, and must finish before it serves
 * requests. In production the server refuses to start when the `.env`
 * contract is incomplete (Operations). Then it starts the one jobs scheduler
 * (Story 2.8): only on the Node.js runtime, never during `next build`, and
 * never under Vitest.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { assertEnvOrExit } = await import("@/server/startup");
  assertEnvOrExit();
  if (process.env.VITEST) return;
  const { startScheduler } = await import("@/server/jobs/scheduler");
  startScheduler();
}
