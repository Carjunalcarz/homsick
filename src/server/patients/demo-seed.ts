import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { opdDate } from "@/lib/time";
import type { Db } from "@/server/db/client";
import { DomainError } from "@/server/db/errors";
import type { Tx } from "@/server/db/tx";
import { insertPatient, nextHospitalNumber } from "./repo";
import { patients, type NewPatientRow } from "./schema";

/*
 * Fictional demo patients for `npm run db:seed:demo` (never real people).
 * Contact numbers use a 555 exchange. The seed writes no audit rows: it is
 * demo data, not a staff action.
 */

/** `created_by` of every demo patient: how the seed recognizes an earlier run. */
export const DEMO_SEED_MARKER = "demo-seed";

export const DEMO_PRODUCTION_MESSAGE = "Demo data is never loaded in production.";
export const DEMO_ALREADY_LOADED_MESSAGE = "Demo patients are already loaded; nothing was added.";

export const DemoSeedError = {
  Production: "demo_seed_production",
  AlreadyLoaded: "demo_seed_already_loaded",
} as const;

type DemoPatient = {
  last: string;
  first: string;
  middle?: string;
  suffix?: string;
  sex: "female" | "male";
  birthdate: string;
  barangay: string;
  municipality: string;
  philhealthPin?: string;
  seniorCitizenId?: string;
  pwdId?: string;
  emergency?: [name: string, number: string];
};

/**
 * 42 patients: children, adults and seniors, both sexes, two "Juan
 * Dela Cruz" and two "Maria Santos" with different birthdates, and a few
 * with PhilHealth, Senior Citizen or PWD IDs. Many carry "Cruz" in a name,
 * so a search for it fills more than one page.
 */
export const DEMO_PATIENTS: readonly DemoPatient[] = [
  { last: "Dela Cruz", first: "Juan", middle: "Santos", sex: "male", birthdate: "1985-04-12", barangay: "Poblacion", municipality: "San Jose", philhealthPin: "01-000000001-1" },
  { last: "Dela Cruz", first: "Juan", middle: "Reyes", sex: "male", birthdate: "1952-11-03", barangay: "San Isidro", municipality: "San Jose", seniorCitizenId: "SC-DEMO-0001" },
  { last: "Dela Cruz", first: "Maria", middle: "Lopez", sex: "female", birthdate: "1990-07-21", barangay: "Santa Rosa", municipality: "Santa Maria" },
  { last: "Dela Cruz", first: "Ana", middle: "Mendoza", sex: "female", birthdate: "2018-01-09", barangay: "Santa Rosa", municipality: "Santa Maria", emergency: ["Maria Dela Cruz", "09175550103"] },
  { last: "Cruz", first: "Jose", middle: "Bautista", suffix: "Jr.", sex: "male", birthdate: "1978-02-14", barangay: "Bagong Silang", municipality: "San Jose" },
  { last: "Cruz", first: "Rosario", middle: "Villanueva", sex: "female", birthdate: "1950-03-15", barangay: "Poblacion", municipality: "Santa Maria", seniorCitizenId: "SC-DEMO-0002", philhealthPin: "01-000000002-2" },
  { last: "Cruz", first: "Miguel", sex: "male", birthdate: "2020-06-30", barangay: "Bagong Silang", municipality: "San Jose", emergency: ["Jose Cruz", "09175550105"] },
  { last: "Santa Cruz", first: "Carmela", middle: "Aquino", sex: "female", birthdate: "1995-09-02", barangay: "Mabini", municipality: "Rizal" },
  { last: "De la Cruz", first: "Pedro", middle: "Garcia", sex: "male", birthdate: "1945-12-25", barangay: "Mabini", municipality: "Rizal", seniorCitizenId: "SC-DEMO-0003", pwdId: "PWD-DEMO-0001" },
  { last: "Dela Cruz", first: "Liza", middle: "Ramos", sex: "female", birthdate: "2001-05-17", barangay: "San Isidro", municipality: "San Jose" },
  { last: "Cruz", first: "Antonio", middle: "Fernandez", suffix: "III", sex: "male", birthdate: "1962-08-08", barangay: "Poblacion", municipality: "Rizal" },
  { last: "Dela Cruz", first: "Paolo", middle: "Castillo", sex: "male", birthdate: "2012-10-10", barangay: "Santo Niño", municipality: "Santa Maria" },
  { last: "Cruzado", first: "Elena", middle: "Diaz", sex: "female", birthdate: "1988-03-03", barangay: "Santo Niño", municipality: "Santa Maria" },
  { last: "Dela Cruz", first: "Josefina", middle: "Torres", sex: "female", birthdate: "1958-04-04", barangay: "Poblacion", municipality: "San Jose", seniorCitizenId: "SC-DEMO-0004" },
  { last: "Cruz", first: "Gabriel", middle: "Navarro", sex: "male", birthdate: "2023-11-11", barangay: "Mabini", municipality: "Rizal", emergency: ["Isabel Navarro", "09175550126"] },
  { last: "Reyes", first: "Teresa", middle: "Cruz", sex: "female", birthdate: "1970-01-20", barangay: "San Roque", municipality: "San Jose" },
  { last: "Santos", first: "Marco", middle: "Cruz", sex: "male", birthdate: "1983-06-06", barangay: "San Roque", municipality: "San Jose" },
  { last: "Garcia", first: "Lorna", middle: "Cruz", sex: "female", birthdate: "1966-02-02", barangay: "Bagong Silang", municipality: "San Jose", philhealthPin: "01-000000003-3" },
  { last: "Mendoza", first: "Ramon", middle: "Dela Cruz", sex: "male", birthdate: "1975-09-09", barangay: "Santa Rosa", municipality: "Santa Maria" },
  { last: "Bautista", first: "Cristina", middle: "Cruz", sex: "female", birthdate: "1999-12-12", barangay: "Mabini", municipality: "Rizal" },
  { last: "Aquino", first: "Daniel", middle: "Cruz", sex: "male", birthdate: "2016-02-29", barangay: "San Isidro", municipality: "San Jose" },
  { last: "Villanueva", first: "Grace", middle: "Cruz", sex: "female", birthdate: "1993-08-15", barangay: "Poblacion", municipality: "Santa Maria" },
  { last: "Torres", first: "Emmanuel", middle: "Cruz", sex: "male", birthdate: "1948-07-07", barangay: "San Roque", municipality: "Rizal", seniorCitizenId: "SC-DEMO-0005" },
  { last: "Ramos", first: "Angelica", middle: "Cruz", sex: "female", birthdate: "2008-03-30", barangay: "Santo Niño", municipality: "Santa Maria" },
  { last: "Castillo", first: "Roberto", middle: "Cruz", suffix: "Sr.", sex: "male", birthdate: "1955-05-05", barangay: "Poblacion", municipality: "San Jose" },
  { last: "Navarro", first: "Isabel", middle: "Cruz", sex: "female", birthdate: "1980-11-30", barangay: "Mabini", municipality: "Rizal" },
  { last: "Fernandez", first: "Carlo", middle: "Cruz", sex: "male", birthdate: "1997-04-01", barangay: "San Isidro", municipality: "San Jose" },
  { last: "Peña", first: "Maria", middle: "Gomez", sex: "female", birthdate: "1972-10-18", barangay: "Santa Rosa", municipality: "Santa Maria" },
  { last: "Santos", first: "Maria", middle: "Lim", sex: "female", birthdate: "1988-01-25", barangay: "San Roque", municipality: "San Jose" },
  { last: "Santos", first: "Maria", middle: "Tan", sex: "female", birthdate: "1964-06-19", barangay: "Poblacion", municipality: "Rizal", seniorCitizenId: "SC-DEMO-0006" },
  { last: "Reyes", first: "Jose", middle: "Garcia", suffix: "Jr.", sex: "male", birthdate: "1991-03-27", barangay: "Bagong Silang", municipality: "San Jose" },
  { last: "Gomez", first: "Ricardo", middle: "Lim", sex: "male", birthdate: "1940-09-14", barangay: "Santo Niño", municipality: "Santa Maria", seniorCitizenId: "SC-DEMO-0007", philhealthPin: "01-000000004-4", emergency: ["Luz Gomez", "09175550132"] },
  { last: "Lim", first: "Jasmine", middle: "Tan", sex: "female", birthdate: "2019-07-04", barangay: "San Isidro", municipality: "San Jose" },
  { last: "Tan", first: "Kevin", middle: "Go", sex: "male", birthdate: "2005-12-01", barangay: "Mabini", municipality: "Rizal" },
  { last: "Ocampo", first: "Luz", middle: "Rivera", sex: "female", birthdate: "1957-02-28", barangay: "San Roque", municipality: "San Jose", seniorCitizenId: "SC-DEMO-0008", pwdId: "PWD-DEMO-0002" },
  { last: "Rivera", first: "Nestor", middle: "Ocampo", sex: "male", birthdate: "1969-10-31", barangay: "Poblacion", municipality: "Santa Maria" },
  { last: "Soriano", first: "Patricia", middle: "Dizon", sex: "female", birthdate: "2010-05-22", barangay: "Santa Rosa", municipality: "Santa Maria" },
  { last: "Dizon", first: "Felipe", middle: "Soriano", sex: "male", birthdate: "1953-01-01", barangay: "Bagong Silang", municipality: "Rizal", seniorCitizenId: "SC-DEMO-0009" },
  { last: "Mercado", first: "Andrea", middle: "Pascual", sex: "female", birthdate: "1986-08-23", barangay: "San Isidro", municipality: "San Jose", pwdId: "PWD-DEMO-0003" },
  { last: "Pascual", first: "Benjamin", middle: "Mercado", sex: "male", birthdate: "2022-04-15", barangay: "San Isidro", municipality: "San Jose", emergency: ["Andrea Mercado", "09175550139"] },
  { last: "Ibañez", first: "Noel", middle: "Salazar", sex: "male", birthdate: "1976-12-19", barangay: "Santo Niño", municipality: "Rizal" },
  { last: "Salazar", first: "Kristine", middle: "Ibañez", sex: "female", birthdate: "2014-09-27", barangay: "Mabini", municipality: "Rizal" },
];

/** Whether an earlier run of the demo seed left its patients. */
export function demoSeedLoaded(db: Db | Tx): boolean {
  return (
    db.select({ id: patients.id }).from(patients).where(eq(patients.createdBy, DEMO_SEED_MARKER)).limit(1).get() !==
    undefined
  );
}

function toRow(patient: DemoPatient, index: number, hospitalNumber: string, at: string): NewPatientRow {
  return {
    id: randomUUID(),
    hospitalNumber,
    lastName: patient.last,
    firstName: patient.first,
    middleName: patient.middle ?? null,
    suffix: patient.suffix ?? null,
    sex: patient.sex,
    birthdate: patient.birthdate,
    addressBarangay: patient.barangay,
    addressMunicipality: patient.municipality,
    // 0917 555 0101, 0917 555 0102, …: a fictional exchange.
    contactNumber: `0917555${String(101 + index).padStart(4, "0")}`,
    philhealthPin: patient.philhealthPin ?? null,
    seniorCitizenId: patient.seniorCitizenId ?? null,
    pwdId: patient.pwdId ?? null,
    emergencyContactName: patient.emergency?.[0] ?? null,
    emergencyContactNumber: patient.emergency?.[1] ?? null,
    privacyNoticeAt: at,
    createdAt: at,
    updatedAt: at,
    createdBy: DEMO_SEED_MARKER,
    deactivatedAt: null,
  };
}

/**
 * Load the demo patients in one IMMEDIATE transaction, each numbered by
 * `nextHospitalNumber()` for the current Manila year (so later registrations
 * continue the sequence). Refuses in production and on a second run; writes
 * no audit rows. Returns how many patients were added.
 */
export function seedDemoPatients(db: Db, now: Date = new Date(), nodeEnv = process.env.NODE_ENV): number {
  if (nodeEnv === "production") throw new DomainError(DemoSeedError.Production, DEMO_PRODUCTION_MESSAGE);
  const at = now.toISOString();
  const year = Number(opdDate(now).slice(0, 4));
  return db.transaction(
    (tx) => {
      if (demoSeedLoaded(tx)) throw new DomainError(DemoSeedError.AlreadyLoaded, DEMO_ALREADY_LOADED_MESSAGE);
      DEMO_PATIENTS.forEach((patient, index) => {
        insertPatient(tx, toRow(patient, index, nextHospitalNumber(tx, year), at));
      });
      return DEMO_PATIENTS.length;
    },
    { behavior: "immediate" },
  );
}
