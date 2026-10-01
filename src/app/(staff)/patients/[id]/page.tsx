import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Forbidden, FORBIDDEN_TITLE } from "@/components/forbidden";
import { formatAge } from "@/lib/age";
import { formatBirthdate } from "@/lib/patient-display";
import { formatManila } from "@/lib/time";
import { can, requirePermission } from "@/server/auth/permissions";
import { getRecordView } from "@/server/patients/service";
import type { PatientRecordData } from "./record-types";
import { PatientRecordScreen } from "./record-screen";

/**
 * The browser tab never shows the patient's name: tabs are visible on
 * shared screens.
 */
const RECORD_TITLE = "Patient record";

export async function generateMetadata(): Promise<Metadata> {
  const { allowed } = await requirePermission("patients.view");
  return { title: allowed ? RECORD_TITLE : FORBIDDEN_TITLE };
}

/**
 * A Patient Record (FR-6): demographics, IDs, the privacy notice and the
 * Visit history. Every render writes one `patient.viewed` audit row
 * (PRIV-2), so links here never prefetch. Triage Nurses and Admins may edit
 * the details; everyone else sees them read-only. Records are never deleted.
 */
export default async function PatientRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { allowed, user } = await requirePermission("patients.view");
  // Decide before reading anything: a denied user gets no data and no view row.
  if (!allowed) return <Forbidden />;

  const { id } = await params;
  const view = getRecordView(id, { type: "staff", id: user.id, name: user.name });
  if (!view) notFound();

  const { patient } = view;
  const record: PatientRecordData = {
    id: patient.id,
    hospitalNumber: patient.hospitalNumber,
    name: view.name,
    lastName: patient.lastName,
    firstName: patient.firstName,
    middleName: patient.middleName,
    suffix: patient.suffix,
    sex: patient.sex,
    birthdate: patient.birthdate,
    birthdateLabel: formatBirthdate(patient.birthdate),
    ageLabel: formatAge(view.age),
    addressBarangay: patient.addressBarangay,
    addressMunicipality: patient.addressMunicipality,
    contactNumber: patient.contactNumber,
    philhealthPin: patient.philhealthPin,
    seniorCitizenId: patient.seniorCitizenId,
    pwdId: patient.pwdId,
    emergencyContactName: patient.emergencyContactName,
    emergencyContactNumber: patient.emergencyContactNumber,
    privacyNoticeLabel: formatManila(patient.privacyNoticeAt),
    deactivated: patient.deactivatedAt !== null,
    updatedAt: patient.updatedAt,
    visits: view.visits,
  };

  return <PatientRecordScreen record={record} canEdit={can(user, "patients.edit")} />;
}
