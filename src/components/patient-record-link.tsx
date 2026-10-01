import type { ComponentProps } from "react";
import Link from "next/link";
import { patientRecordPath } from "@/lib/patient-links";

/**
 * A link to a Patient Record. It never prefetches: rendering a record
 * writes a `patient.viewed` audit row, so only a real visit may render it.
 */
export function PatientRecordLink({
  patientId,
  ...props
}: Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { patientId: string }) {
  return <Link {...props} href={patientRecordPath(patientId)} prefetch={false} />;
}
