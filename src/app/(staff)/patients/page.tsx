import type { Metadata } from "next";
import { Forbidden, FORBIDDEN_TITLE } from "@/components/forbidden";
import { parseListParams, type SearchParams } from "@/lib/url-query";
import { requirePermission } from "@/server/auth/permissions";
import { searchPatients } from "@/server/patients/queries";
import { PatientsScreen } from "./patients-screen";

/** Rows per page on the patient list. */
const PAGE_SIZE = 25;

/** The patient list's URL: only `q` and `page`. */
const PATIENT_LIST = { filters: {} } as const;

export async function generateMetadata(): Promise<Metadata> {
  const { allowed } = await requirePermission("patients.view");
  return { title: allowed ? "Patients" : FORBIDDEN_TITLE };
}

/** Find patients (FR-4): one search for name, Hospital Number, birthdate or phone. Not audited. */
export default async function PatientsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { allowed } = await requirePermission("patients.view");
  if (!allowed) return <Forbidden />;

  const params = parseListParams(await searchParams, PATIENT_LIST);
  const list = searchPatients({ q: params.q, page: params.page, pageSize: PAGE_SIZE });

  return (
    <PatientsScreen
      rows={list.rows.map((row) => ({
        id: row.id,
        name: row.name,
        hospitalNumber: row.hospitalNumber,
        age: row.age,
        sex: row.sex,
        birthdate: row.birthdate,
        lastVisit: row.lastVisit,
      }))}
      total={list.total}
      page={list.page}
      pageCount={list.pageCount}
      q={params.q}
    />
  );
}
