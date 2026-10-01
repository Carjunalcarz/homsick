import type { PatientSex } from "@/lib/patient-name";
import type { PatientVisitSummary } from "@/server/patients/service";

/** One Visit in the history: date, status and Urgency Level (no clinical values). Type-only: nothing server-side reaches the client. */
export type RecordVisitData = PatientVisitSummary;

/**
 * What the record screen gets: the stored fields (raw, to prefill the edit
 * sheet), plus display text formatted on the server so the client renders
 * exactly the same strings.
 */
export type PatientRecordData = {
  id: string;
  hospitalNumber: string;
  /** `formatPatientName()`: "DELA CRUZ, Juan Santos". */
  name: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  suffix: string | null;
  sex: PatientSex;
  /** `YYYY-MM-DD`. */
  birthdate: string;
  /** e.g. "Apr 12, 1985". */
  birthdateLabel: string;
  /** e.g. "41 y", or "—". */
  ageLabel: string;
  addressBarangay: string;
  addressMunicipality: string;
  contactNumber: string;
  philhealthPin: string | null;
  seniorCitizenId: string | null;
  pwdId: string | null;
  emergencyContactName: string | null;
  emergencyContactNumber: string | null;
  /** When the privacy notice was explained, in Manila time. */
  privacyNoticeLabel: string;
  deactivated: boolean;
  /** The stored `updated_at`: the edit sheet sends it back so a save over someone else's is refused. */
  updatedAt: string;
  visits: RecordVisitData[];
};
