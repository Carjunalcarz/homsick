/** The Patient Record page for `id`: used by every link to a record and by the edit action's revalidation. */
export function patientRecordPath(id: string): string {
  return `/patients/${encodeURIComponent(id)}`;
}
