import type { Metadata } from "next";
import { Forbidden, FORBIDDEN_TITLE } from "@/components/forbidden";
import { parseListParams, type SearchParams } from "@/lib/url-query";
import { can, requirePermission } from "@/server/auth/permissions";
import { listStaff, STAFF_STATUSES } from "@/server/auth/staff-queries";
import { PASSWORD_MAX, PASSWORD_MIN, STAFF_ROLES } from "@/server/auth/staff-rules";
import { listFacilities } from "@/server/settings/queries";
import { StaffScreen } from "./staff-screen";
import type { FacilityOption, StaffRowData } from "./staff-types";

/** Rows per page on the staff list. */
const PAGE_SIZE = 25;

/** The staff list's URL filters (`q` and `page` are always there). */
const STAFF_LIST = {
  filters: {
    role: { values: ["all", ...STAFF_ROLES], default: "all" },
    status: { values: ["all", ...STAFF_STATUSES], default: "all" },
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const { allowed } = await requirePermission("staff.view");
  return { title: allowed ? "Staff" : FORBIDDEN_TITLE };
}

/** Admin: staff accounts, Roles and Facilities (FR2, FR3). */
export default async function StaffPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { allowed, user } = await requirePermission("staff.view");
  // Decide before reading anything: a denied user gets no data at all.
  if (!allowed) return <Forbidden />;

  const params = parseListParams(await searchParams, STAFF_LIST);
  const now = new Date();
  const list = listStaff(
    { q: params.q, role: params.role, status: params.status, page: params.page, pageSize: PAGE_SIZE },
    undefined,
    now,
  );
  const rows: StaffRowData[] = list.rows.map((member) => ({
    id: member.id,
    name: member.name,
    username: member.username,
    role: member.role,
    status: member.status,
    failedAttempts: member.failedAttempts,
    facilities: member.facilities,
  }));
  const facilities: FacilityOption[] = listFacilities(now).map((f) => ({
    id: f.id,
    name: f.name,
    prefix: f.currentPrefix,
    active: f.deactivatedAt === null,
  }));

  return (
    <StaffScreen
      rows={rows}
      total={list.total}
      page={list.page}
      pageCount={list.pageCount}
      q={params.q}
      role={params.role}
      status={params.status}
      facilities={facilities}
      currentUserId={user.id}
      canManage={can(user, "staff.manage")}
      passwordLimits={{ min: PASSWORD_MIN, max: PASSWORD_MAX }}
    />
  );
}
