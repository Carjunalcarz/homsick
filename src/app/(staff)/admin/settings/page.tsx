import type { Metadata } from "next";
import { Forbidden, FORBIDDEN_TITLE } from "@/components/forbidden";
import { PageTitle } from "@/components/page-title";
import { can, requirePermission } from "@/server/auth/permissions";
import {
  clinicalSchedules,
  listFacilities,
  opdThresholds,
  pendingPrefix,
  priorityCategories,
  urgencyLevels,
} from "@/server/settings/queries";
import { FacilitiesSection, type FacilityCardData } from "./facilities-section";
import { OpdThresholdsSection } from "./opd-thresholds-section";
import { PriorityCategoriesSection } from "./priority-categories-section";
import { SchedulesSection } from "./schedules-section";
import { UrgencyLevelsSection } from "./urgency-levels-section";

export async function generateMetadata(): Promise<Metadata> {
  const { allowed } = await requirePermission("settings.view");
  return { title: allowed ? "Settings" : FORBIDDEN_TITLE };
}

/** Admin: OPD Settings (FR23, FR-24). Facilities, then the triage and clinical settings. */
export default async function SettingsPage() {
  const { allowed, user } = await requirePermission("settings.view");
  // Decide before reading any settings: a denied user gets no data at all.
  if (!allowed) return <Forbidden />;

  const now = new Date();
  const facilities: FacilityCardData[] = listFacilities(now).map((facility) => {
    const pending = pendingPrefix(facility, now);
    return {
      id: facility.id,
      name: facility.name,
      currentPrefix: facility.currentPrefix,
      pending,
      openDays: facility.openDays,
      openTime: facility.openTime,
      closeTime: facility.closeTime,
      isLive: facility.isLive,
      active: facility.deactivatedAt === null,
    };
  });
  const canManageClinical = can(user, "settings.clinical.manage");

  return (
    <>
      <PageTitle
        title="OPD Settings"
        description="Facilities, Urgency Levels, Priority Categories, Animal Bite Center schedules, and queue and prenatal thresholds. Changes apply to new entries only."
      />
      <FacilitiesSection facilities={facilities} canManage={can(user, "settings.facilities.manage")} />
      <UrgencyLevelsSection levels={urgencyLevels()} canManage={canManageClinical} />
      <PriorityCategoriesSection
        categories={priorityCategories().map(({ id, name, legalBasis, legallyRequired, enabled }) => ({
          id,
          name,
          legalBasis,
          legallyRequired,
          enabled,
        }))}
        canManage={canManageClinical}
      />
      <SchedulesSection
        schedules={clinicalSchedules().map(({ id, name, days }) => ({ id, name, days }))}
        canManage={canManageClinical}
      />
      <OpdThresholdsSection thresholds={opdThresholds()} canManage={canManageClinical} />
    </>
  );
}
