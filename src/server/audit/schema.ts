import "server-only";
import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Every action the audit log records (AD-3). Later stories add their own.
 * Stored as the string value.
 */
export const AuditAction = {
  AuthSignIn: "auth.sign_in",
  AuthSignOut: "auth.sign_out",
  AuthSignInFailed: "auth.sign_in_failed",
  AdminCreated: "admin.created",
  AuthLocked: "auth.locked",
  AuthUnlocked: "auth.unlocked",
  SettingsFacilityUpdated: "settings.facility_updated",
  SettingsFacilityDeactivated: "settings.facility_deactivated",
  SettingsFacilityReactivated: "settings.facility_reactivated",
  SettingsUrgencyLevelsUpdated: "settings.urgency_levels_updated",
  SettingsPriorityCategoryUpdated: "settings.priority_category_updated",
  SettingsScheduleUpdated: "settings.schedule_updated",
  SettingsOpdThresholdsUpdated: "settings.opd_thresholds_updated",
  StaffCreated: "staff.created",
  StaffUpdated: "staff.updated",
  StaffPasswordSet: "staff.password_set",
  StaffDeactivated: "staff.deactivated",
  StaffReactivated: "staff.reactivated",
  AuditViewed: "audit.viewed",
  PatientCreated: "patient.created",
  PatientViewed: "patient.viewed",
  PatientUpdated: "patient.updated",
  TriageRecorded: "triage.recorded",
  JobsBackupCompleted: "jobs.backup_completed",
  JobsBackupFailed: "jobs.backup_failed",
  JobsRateLimitsPurged: "jobs.rate_limits_purged",
  JobsRateLimitsPurgeFailed: "jobs.rate_limits_purge_failed",
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** Every `AuditAction` value, in declaration order. */
export const AUDIT_ACTIONS = Object.values(AuditAction) as AuditAction[];

/** A readable label for each action, for the audit log page. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "auth.sign_in": "Signed in",
  "auth.sign_out": "Signed out",
  "auth.sign_in_failed": "Sign-in failed",
  "admin.created": "Admin created (CLI)",
  "auth.locked": "Account locked",
  "auth.unlocked": "Account unlocked",
  "settings.facility_updated": "Facility updated",
  "settings.facility_deactivated": "Facility deactivated",
  "settings.facility_reactivated": "Facility reactivated",
  "settings.urgency_levels_updated": "Urgency Levels updated",
  "settings.priority_category_updated": "Priority Category changed",
  "settings.schedule_updated": "Dose schedule updated",
  "settings.opd_thresholds_updated": "OPD thresholds updated",
  "staff.created": "Staff account created",
  "staff.updated": "Staff account updated",
  "staff.password_set": "Temporary password set",
  "staff.deactivated": "Staff account deactivated",
  "staff.reactivated": "Staff account reactivated",
  "audit.viewed": "Audit log viewed",
  "patient.created": "Patient registered",
  "patient.viewed": "Patient record viewed",
  "patient.updated": "Patient details updated",
  "triage.recorded": "Triage recorded",
  "jobs.backup_completed": "Nightly backup completed",
  "jobs.backup_failed": "Nightly backup failed",
  "jobs.rate_limits_purged": "Old rate-limit rows removed",
  "jobs.rate_limits_purge_failed": "Rate-limit cleanup failed",
};

/** The entities audit rows are written about (`audit_log.entity`). */
export const AUDIT_ENTITIES = [
  "user",
  "facility",
  "urgency_levels",
  "priority_category",
  "clinical_schedule",
  "opd_settings",
  "audit_log",
  "job_run",
  "patient",
  "visit",
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

/** A readable label for each entity, for the audit log page. */
export const AUDIT_ENTITY_LABELS: Record<AuditEntity, string> = {
  user: "Staff account",
  facility: "Facility",
  urgency_levels: "Urgency Levels",
  priority_category: "Priority Category",
  clinical_schedule: "Dose schedule",
  opd_settings: "OPD thresholds",
  audit_log: "Audit log",
  job_run: "Scheduled job run",
  patient: "Patient",
  visit: "Visit",
};

export const actorTypes = ["staff", "system"] as const;
export type ActorType = (typeof actorTypes)[number];

/**
 * The append-only audit log. UPDATE and DELETE are rejected by triggers in
 * the `audit_log_immutable` migration. `at` is UTC ISO-8601 text; `changes`
 * is a JSON object of the changed fields (never a password).
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    actorType: text("actor_type", { enum: actorTypes }).notNull(),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    changes: text("changes"),
  },
  (table) => [
    check("audit_log_actor_type_check", sql`${table.actorType} in ('staff', 'system')`),
    index("audit_log_at_idx").on(table.at),
    index("audit_log_actor_id_idx").on(table.actorId),
    index("audit_log_entity_idx").on(table.entity, table.entityId),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
