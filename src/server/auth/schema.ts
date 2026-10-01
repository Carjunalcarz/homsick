import "server-only";
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
// Relative, so drizzle-kit resolves it without the tsconfig alias.
import { facilities } from "../settings/schema";

/*
 * Better Auth 1.7.6 tables, written by hand (no schema CLI ships for 1.7.6).
 * The adapter runs with `usePlural: true`, so the export keys are the plural
 * model names and each column's property name is Better Auth's field name.
 * Columns follow the core schema plus the username() and admin() plugins.
 * Timestamps stay the library's integer milliseconds (AD-7 exception).
 */

const createdAt = (name = "created_at") =>
  integer(name, { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: createdAt("updated_at"),
  // username() plugin
  username: text("username").unique(),
  displayUsername: text("display_username"),
  // admin() plugin
  role: text("role"),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
  // App-owned lockout state (Story 2.3). Not Better Auth fields: `banned` is
  // reserved for deactivation. `locked_at` is UTC ISO-8601 text.
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedAt: text("locked_at"),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // admin() plugin
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
    updatedAt: createdAt("updated_at"),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

/**
 * Better Auth's `rateLimit` model (storage: "database"), plural through
 * `usePlural`. `last_request` is the library's integer milliseconds. The
 * sign-in server action keeps its own per-IP counters here too, under keys
 * prefixed `action:sign-in:`.
 */
export const rateLimits = sqliteTable("rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

/**
 * Facility assignments (Story 2.5), owned by `auth`. Facility Staff have at
 * least one active Facility; Triage Nurses and Admins have none. Rows are
 * replaced by staff commands; neither side is ever hard-deleted, so the
 * foreign keys don't cascade.
 */
export const userFacilities = sqliteTable(
  "user_facilities",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    facilityId: text("facility_id")
      .notNull()
      .references(() => facilities.id),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.facilityId] }),
    index("user_facilities_facility_id_idx").on(table.facilityId),
  ],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
