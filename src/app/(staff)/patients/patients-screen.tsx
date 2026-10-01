import { DataTableEmptyState } from "@/components/data-table/empty-state";
import { PatientRecordLink } from "@/components/patient-record-link";
import { DataTablePagination } from "@/components/data-table/pagination";
import { DataTableToolbar } from "@/components/data-table/toolbar";
import { PageTitle } from "@/components/page-title";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAge } from "@/lib/age";
import { SEX_LABELS, type PatientSex } from "@/lib/patient-name";
import { formatBirthdate, formatLastVisit, PATIENT_SEARCH_HINT, PATIENT_SEARCH_PLACEHOLDER } from "@/lib/patient-display";

const BASE_PATH = "/patients";
const DEFAULTS = { q: "" };

export type PatientRowData = {
  id: string;
  name: string;
  hospitalNumber: string;
  age: number | null;
  sex: PatientSex;
  birthdate: string;
  lastVisit: string | null;
};

/** The patient list: search, table, pagination. The name opens the record (/patients/[id]). */
export function PatientsScreen({
  rows,
  total,
  page,
  pageCount,
  q,
}: {
  rows: PatientRowData[];
  total: number;
  page: number;
  pageCount: number;
  q: string;
}) {
  const noun = total === 1 ? "1 patient" : `${total} patients`;
  return (
    <>
      <PageTitle title="Patients" description="Find a patient by name, Hospital Number, birthdate or phone." />

      <section
        aria-labelledby="patient-list-heading"
        className="flex min-w-0 flex-col gap-4 rounded-md bg-card p-4 shadow-[0_1px_3px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.04] md:p-6 dark:ring-white/[0.06]"
      >
        <h2 id="patient-list-heading" className="sr-only">
          Patient list
        </h2>
        <DataTableToolbar
          basePath={BASE_PATH}
          id="patients"
          label="Find patients"
          searchLabel="Search"
          searchPlaceholder={PATIENT_SEARCH_PLACEHOLDER}
          q={q}
        />

        <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-muted-foreground">
          {q ? `${noun} ${total === 1 ? "matches" : "match"}` : noun}
        </p>

        {rows.length === 0 ? (
          <DataTableEmptyState
            title={q ? `No patients match "${q}".` : "No patients yet."}
            hint={q ? PATIENT_SEARCH_HINT : "Registered patients appear here."}
            clearHref={q ? BASE_PATH : undefined}
            clearLabel="Clear search"
          />
        ) : (
          // The table scrolls in this one region on narrow screens (keyboard: focus it, then arrow keys).
          <div
            role="region"
            aria-label="Patients"
            tabIndex={0}
            data-slot="table-container"
            className="relative min-w-0 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <table data-slot="table" className="w-full min-w-[720px] caption-bottom text-sm">
              <caption className="sr-only">
                Patients{q ? ` matching "${q}"` : ""}, sorted by last name. Page {page} of {pageCount}.
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Name</TableHead>
                  <TableHead scope="col">Hospital Number</TableHead>
                  <TableHead scope="col">Age</TableHead>
                  <TableHead scope="col">Sex</TableHead>
                  <TableHead scope="col">Birthdate</TableHead>
                  <TableHead scope="col">Last visit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((patient) => (
                  <TableRow key={patient.id}>
                    <TableCell className="font-medium">
                      <PatientRecordLink
                        patientId={patient.id}
                        className="inline-flex min-h-11 items-center rounded text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {patient.name}
                      </PatientRecordLink>
                    </TableCell>
                    <TableCell>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">{patient.hospitalNumber}</span>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatAge(patient.age)}</TableCell>
                    <TableCell>{SEX_LABELS[patient.sex]}</TableCell>
                    <TableCell className="tabular-nums">{formatBirthdate(patient.birthdate)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatLastVisit(patient.lastVisit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        )}

        <DataTablePagination basePath={BASE_PATH} values={{ q }} defaults={DEFAULTS} page={page} pageCount={pageCount} />
      </section>
    </>
  );
}
