import type { Metadata } from "next";
import { Forbidden, FORBIDDEN_TITLE } from "@/components/forbidden";
import { PageTitle } from "@/components/page-title";
import { can, requirePermission } from "@/server/auth/permissions";
import { TriageWorkspace } from "./triage-workspace";

export async function generateMetadata(): Promise<Metadata> {
  const { allowed } = await requirePermission("triage.view");
  return { title: allowed ? "Triage" : FORBIDDEN_TITLE };
}

/**
 * Triage: find the patient (Story 3.1), record triage (Story 3.4), then issue
 * a Queue Number or direct to the ER (Story 3.5). Each action checks its own
 * permission again.
 */
export default async function TriagePage() {
  const { allowed, user } = await requirePermission("triage.view");
  if (!allowed) return <Forbidden />;

  return (
    <>
      <PageTitle title="Triage" description="Find the patient, record triage, then issue a queue number." />
      {/* Hiding the "New patient" row is cosmetic: the action checks patients.register itself. */}
      <TriageWorkspace canRegister={can(user, "patients.register")} canRecord={can(user, "triage.record")} />
    </>
  );
}
