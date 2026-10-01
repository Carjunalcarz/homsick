import "server-only";
import path from "node:path";
import { AuditAction } from "@/server/audit/schema";
import { backupTo, NIGHTLY_KEEP, NIGHTLY_PREFIX, pruneBackups } from "@/server/db/backup";
import { BACKUP_JOB } from "./names";
import type { JobDefinition } from "./types";

/**
 * The nightly backup (AD-12): at 02:00 Manila, `VACUUM INTO`
 * `BACKUP_DIR/opd-<opd_date>.sqlite`, then keep the newest NIGHTLY_KEEP
 * nightly files. The copy can't run in a transaction, so it happens first;
 * the `job_runs` update and the audit row commit right after.
 */
export const backupJob: JobDefinition = {
  name: BACKUP_JOB,
  actorName: "backup job",
  dueMinutes: 2 * 60,
  key: (opdDate) => opdDate,
  successAction: AuditAction.JobsBackupCompleted,
  failureAction: AuditAction.JobsBackupFailed,
  run: ({ db, opdDate, backupDir }) => {
    const name = `${NIGHTLY_PREFIX}${opdDate}.sqlite`;
    // Temp file ages are compared with the real clock (file times are real).
    const { bytes } = backupTo(db, path.join(backupDir, name), NIGHTLY_PREFIX);
    // The copy is good, so a pruning problem doesn't fail the backup: it is
    // recorded on the success audit row instead.
    let pruned = 0;
    let pruneError: string | undefined;
    try {
      pruned = pruneBackups(backupDir, NIGHTLY_PREFIX, NIGHTLY_KEEP, name).length;
    } catch (error) {
      pruneError = error instanceof Error ? error.message : String(error);
    }
    return () => ({ file: name, bytes, pruned, ...(pruneError ? { pruneError } : {}) });
  },
};
