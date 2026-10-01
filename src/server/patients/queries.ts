import "server-only";
import { and, asc, count, eq, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { ageOn } from "@/lib/age";
import { formatPatientName, type PatientSex } from "@/lib/patient-name";
import { parsePatientQuery } from "@/lib/patient-search";
import { opdDate } from "@/lib/time";
import { getDb, type Db } from "@/server/db/client";
import type { Tx } from "@/server/db/tx";
import { lastVisitDates } from "@/server/visits/queries";
import { patients, type PatientRow } from "./schema";

/*
 * Patient reads (Story 3.1). `patients` owns `patients` and
 * `hospital_number_counters`. Searching is not audited (a record view is,
 * Story 3.3), and nothing here logs names, numbers or queries.
 */

export type PatientSearchInput = {
  /** The search box text: trimmed here. Empty lists every active patient. */
  q?: string;
  page?: number;
  pageSize?: number;
};

export type PatientSearchRow = {
  id: string;
  hospitalNumber: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  suffix: string | null;
  /** `formatPatientName()`: "DELA CRUZ, Juan Santos". */
  name: string;
  sex: PatientSex;
  /** `YYYY-MM-DD`. */
  birthdate: string;
  /** Whole years on today's Manila date; null for a birthdate in the future. */
  age: number | null;
  /** The last Visit's OPD date (`YYYY-MM-DD`), from `visits.lastVisitDates`; null with no Visit. */
  lastVisit: string | null;
};

/** What the finder (and the Possible match card) gets per patient: no address or contact details. */
export type PatientFinderRow = Pick<
  PatientSearchRow,
  "id" | "hospitalNumber" | "lastName" | "firstName" | "middleName" | "suffix" | "name" | "sex" | "birthdate" | "age" | "lastVisit"
>;

export function toFinderRow(row: PatientSearchRow): PatientFinderRow {
  return {
    id: row.id,
    hospitalNumber: row.hospitalNumber,
    lastName: row.lastName,
    firstName: row.firstName,
    middleName: row.middleName,
    suffix: row.suffix,
    name: row.name,
    sex: row.sex,
    birthdate: row.birthdate,
    age: row.age,
    lastVisit: row.lastVisit,
  };
}

type RowColumns = Omit<PatientSearchRow, "name" | "age" | "lastVisit">;

const ROW_COLUMNS = {
  id: patients.id,
  hospitalNumber: patients.hospitalNumber,
  lastName: patients.lastName,
  firstName: patients.firstName,
  middleName: patients.middleName,
  suffix: patients.suffix,
  sex: patients.sex,
  birthdate: patients.birthdate,
};

/** A stored row as a search row: display name, age on `today` (Manila) and last Visit (null unless given). */
export function toSearchRow(row: RowColumns, today: string, lastVisit: string | null = null): PatientSearchRow {
  return {
    ...row,
    name: formatPatientName(row),
    age: ageOn(row.birthdate, today),
    lastVisit,
  };
}

/** Search rows for stored rows, each with its last Visit date from the `visits` queries. */
function withLastVisits(db: Db | Tx, rows: RowColumns[], today: string): PatientSearchRow[] {
  const last = rows.length > 0 ? lastVisitDates(rows.map((row) => row.id), db) : new Map<string, string>();
  return rows.map((row) => toSearchRow(row, today, last.get(row.id) ?? null));
}

/**
 * Active patients with this last name, first name (Unicode case-insensitive,
 * NFC, spaces collapsed; stored names are NFC) and birthdate: the Possible match check of Story 3.2.
 */
export function selectPossibleMatches(
  db: Db | Tx,
  input: { lastName: string; firstName: string; birthdate: string },
  now: Date = new Date(),
  /** A patient never matches themself (an edit of their own record). */
  excludeId?: string,
): PatientFinderRow[] {
  const fold = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  const rows = db
    .select(ROW_COLUMNS)
    .from(patients)
    .where(
      and(
        isNull(patients.deactivatedAt),
        excludeId === undefined ? undefined : ne(patients.id, excludeId),
        eq(patients.birthdate, input.birthdate),
        sql`unicode_lower(trim(${patients.lastName})) = ${fold(input.lastName)}`,
        sql`unicode_lower(trim(${patients.firstName})) = ${fold(input.firstName)}`,
      ),
    )
    .orderBy(asc(patients.hospitalNumber))
    .all();
  const today = opdDate(now);
  return withLastVisits(db, rows, today).map(toFinderRow);
}

/** A whole stored patient row, without the derived `search_text`. */
export type PatientRecordRow = Omit<PatientRow, "searchText">;

/**
 * One patient's stored row by id (deactivated ones too), or undefined. Not
 * audited here: the record view (`getRecordView`) audits each view.
 */
export function selectPatientRecord(db: Db | Tx, id: string): PatientRecordRow | undefined {
  const row = db.select().from(patients).where(eq(patients.id, id)).get();
  if (!row) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { searchText, ...record } = row;
  return record;
}

export type PatientSearchPage = {
  rows: PatientSearchRow[];
  total: number;
  /** The page shown, clamped to 1..pageCount. */
  page: number;
  pageCount: number;
  pageSize: number;
};

/** Digits of the stored contact number (spaces, dashes, dots, brackets and + removed). */
const contactDigits = sql`replace(replace(replace(replace(replace(replace(${patients.contactNumber}, ' ', ''), '-', ''), '.', ''), '(', ''), ')', ''), '+', '')`;

/** The WHERE for one search box query, or undefined for an empty one. */
function searchCondition(raw: string | undefined): SQL | undefined {
  const query = parsePatientQuery(raw);
  if (!query.name) return undefined;
  const matches: SQL[] = [
    // search_text holds the lowercased name forms ("juan dela cruz",
    // "dela cruz, juan santos", …), written by the repo: one cheap instr per row.
    sql`instr(${patients.searchText}, ${query.name}) > 0`,
    sql`instr(${patients.hospitalNumber}, ${query.hospitalNumber}) > 0`,
  ];
  if (query.birthdate) matches.push(eq(patients.birthdate, query.birthdate));
  for (const digits of query.phoneDigits) matches.push(sql`instr(${contactDigits}, ${digits}) > 0`);
  return or(...matches);
}

/**
 * The one patient search (FR-4): part of a name (Unicode case-insensitive,
 * also "first last" and "last, first"), part of the Hospital Number, a whole
 * birthdate (`YYYY-MM-DD` or `MM/DD/YYYY`) or at least 4 phone digits.
 * Deactivated patients are never listed. Sorted by last name, then first.
 */
export function searchPatients(
  input: PatientSearchInput = {},
  db: Db | Tx = getDb(),
  now: Date = new Date(),
): PatientSearchPage {
  const pageSize = Math.max(1, Math.floor(input.pageSize ?? 25));
  const where = and(isNull(patients.deactivatedAt), searchCondition(input.q));

  const total = db.select({ n: count() }).from(patients).where(where).get()?.n ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number.isFinite(input.page) ? Math.floor(input.page!) : 1;
  const page = Math.min(Math.max(1, requested), pageCount);

  const rows = db
    .select(ROW_COLUMNS)
    .from(patients)
    .where(where)
    .orderBy(
      asc(sql`${patients.lastName} collate nocase`),
      asc(sql`${patients.firstName} collate nocase`),
      asc(sql`coalesce(${patients.middleName}, '') collate nocase`),
      asc(patients.birthdate),
      asc(patients.hospitalNumber),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const today = opdDate(now);
  return {
    rows: withLastVisits(db, rows, today),
    total,
    page,
    pageCount,
    pageSize,
  };
}
