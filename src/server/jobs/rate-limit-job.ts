import "server-only";
import { AuditAction } from "@/server/audit/schema";
import { purgeRateLimits, RATE_LIMIT_RETENTION_MS } from "@/server/auth/rate-limits";
import { RATE_LIMIT_PURGE_JOB } from "./names";
import type { JobDefinition } from "./types";

/**
 * Daily at 03:00 Manila: delete `rate_limits` rows untouched for 24 hours,
 * through `auth` (which owns the table), and audit the count.
 */
export const rateLimitPurgeJob: JobDefinition = {
  name: RATE_LIMIT_PURGE_JOB,
  actorName: "rate-limit cleanup",
  dueMinutes: 3 * 60,
  key: (opdDate) => opdDate,
  successAction: AuditAction.JobsRateLimitsPurged,
  failureAction: AuditAction.JobsRateLimitsPurgeFailed,
  run: ({ now }) => {
    const before = now.getTime() - RATE_LIMIT_RETENTION_MS;
    return (tx) => ({ deleted: purgeRateLimits(tx, before), before: new Date(before).toISOString() });
  },
};
