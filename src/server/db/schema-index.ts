import "server-only";

/**
 * The schema index: every module's tables, for the Drizzle client. Each table
 * is owned by one module (AD-2). drizzle-kit reads the module `schema.ts`
 * files directly (see drizzle.config.ts).
 */
export * from "../auth/schema";
export * from "../audit/schema";
export * from "../settings/schema";
export * from "../jobs/schema";
export * from "../patients/schema";
export * from "../visits/schema";
export * from "../triage/schema";
export * from "../queue/schema";
