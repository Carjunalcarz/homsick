// Patient display helpers, shared by server and client.

export type PatientNameParts = {
  lastName: string;
  firstName: string;
  middleName?: string | null;
  suffix?: string | null;
};

/**
 * The one way a patient's name is shown: "DELA CRUZ, Juan Santos Jr." (last
 * name in capitals, then first, middle and suffix).
 */
export function formatPatientName({ lastName, firstName, middleName, suffix }: PatientNameParts): string {
  const given = [firstName, middleName, suffix]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const last = lastName.trim().toUpperCase();
  return given ? `${last}, ${given}` : last;
}

/** The longest a name part may be (after trimming). */
export const PATIENT_NAME_MAX = 60;

export const PATIENT_SEXES = ["female", "male"] as const;
export type PatientSex = (typeof PATIENT_SEXES)[number];

export const SEX_LABELS: Record<PatientSex, string> = { female: "Female", male: "Male" };
