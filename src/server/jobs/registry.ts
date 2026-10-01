import "server-only";
import { backupJob } from "./backup-job";
import { rateLimitPurgeJob } from "./rate-limit-job";
import type { JobDefinition } from "./types";

/**
 * Every scheduled job, run in this order on each tick. Epics 4 and 6 add
 * theirs here (facility close, missed appointments, pre-close warning).
 */
export const JOBS: readonly JobDefinition[] = [backupJob, rateLimitPurgeJob];
