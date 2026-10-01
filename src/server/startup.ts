import "server-only";
import { getEnv } from "./env";

/**
 * Startup check (Operations): exit the server process when the `.env`
 * contract is incomplete, instead of serving errors. The message names the
 * missing keys, never the values.
 */
export function assertEnvOrExit() {
  try {
    getEnv();
  } catch (error) {
    console.error(`OPD refused to start. ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
