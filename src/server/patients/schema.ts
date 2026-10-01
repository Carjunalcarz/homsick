import "server-only";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Patient sex as recorded (`female` / `male`). Kept in step with `PATIENT_SEXES` in `src/lib/patient-name.ts`. */
export const patientSexes = ["female", "male"] as const;

/**
 * Patients (FR-4, Story 3.1), owned by the `patients` module. Other modules
 * read them only through `patients/queries.ts`.
 *
 * - `hospital_number` is `HN-YYYY-NNNNNN`, issued only by
 *   `nextHospitalNumber()` (repo.ts) from `hospital_number_counters`.
 * - The name is stored in parts; display it with `formatPatientName()`
 *   ("DELA CRUZ, Juan Santos").
 * - `birthdate` is `YYYY-MM-DD`; age is always calculated (`ageOn`), never stored.
 * - Timestamps are UTC ISO text. `created_by` is the staff user id (the
 *   demo seed writes its own marker instead).
 * - Nothing is deleted: `deactivated_at` hides a patient from search.
 */
export const patients = sqliteTable(
  "patients",
  {
    id: text("id").primaryKey(),
    hospitalNumber: text("hospital_number").notNull(),
    lastName: text("last_name").notNull(),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    suffix: text("suffix"),
    sex: text("sex", { enum: patientSexes }).notNull(),
    birthdate: text("birthdate").notNull(),
    addressBarangay: text("address_barangay").notNull(),
    addressMunicipality: text("address_municipality").notNull(),
    contactNumber: text("contact_number").notNull(),
    philhealthPin: text("philhealth_pin"),
    seniorCitizenId: text("senior_citizen_id"),
    pwdId: text("pwd_id"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactNumber: text("emergency_contact_number"),
    privacyNoticeAt: text("privacy_notice_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by").notNull(),
    deactivatedAt: text("deactivated_at"),
    /**
     * The name forms search matches, lowercased: "first last", "first
     * middle last suffix" and "last, first middle suffix", one per line.
     * Written only by the repo (`patientSearchText`), never by hand.
     */
    searchText: text("search_text").notNull().default(""),
  },
  (table) => [
    uniqueIndex("patients_hospital_number_unique").on(table.hospitalNumber),
    index("patients_name_idx").on(sql`${table.lastName} collate nocase`, sql`${table.firstName} collate nocase`),
    index("patients_birthdate_idx").on(table.birthdate),
    check("patients_sex_check", sql`${table.sex} in ('female', 'male')`),
    check(
      "patients_hospital_number_check",
      sql`${table.hospitalNumber} glob 'HN-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]'`,
    ),
    check(
      "patients_birthdate_check",
      sql`${table.birthdate} glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`,
    ),
    check("patients_names_check", sql`length(trim(${table.lastName})) > 0 and length(trim(${table.firstName})) > 0`),
  ],
);

export type PatientRow = typeof patients.$inferSelect;
export type NewPatientRow = typeof patients.$inferInsert;

/**
 * The last Hospital Number sequence issued per year, owned by `patients`.
 * Only `nextHospitalNumber()` touches it.
 */
export const hospitalNumberCounters = sqliteTable(
  "hospital_number_counters",
  {
    year: integer("year").primaryKey(),
    lastSeq: integer("last_seq").notNull(),
  },
  (table) => [
    check("hospital_number_counters_year_check", sql`${table.year} between 1900 and 9999`),
    check("hospital_number_counters_seq_check", sql`${table.lastSeq} between 0 and 999999`),
  ],
);
