import {
  BookUser,
  CalendarDays,
  LayoutDashboard,
  ListOrdered,
  ScrollText,
  Settings,
  Stethoscope,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Action } from "@/server/auth/permissions";

/** A top-nav item, shown only to Roles that `can()` do `action` (cosmetic: pages check too). */
export type NavItem = { href: string; label: string; icon: LucideIcon; action: Action };

/** Staff pages, shown in the top bar (and in the menu sheet on phones). */
export const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard, action: "nav.overview" },
  { href: "/triage", label: "Triage", icon: Stethoscope, action: "nav.triage" },
  { href: "/queues", label: "Queues", icon: ListOrdered, action: "nav.queues" },
  { href: "/patients", label: "Patients", icon: Users, action: "nav.patients" },
  { href: "/appointments", label: "Appointments", icon: CalendarDays, action: "nav.appointments" },
  { href: "/directory", label: "Directory", icon: BookUser, action: "nav.directory" },
];

/** The nav items whose href is in `allowed` (computed on the server with `can()`). */
export function visibleNav(allowed: readonly string[]): NavItem[] {
  return MAIN_NAV.filter((item) => allowed.includes(item.href));
}

/** An Admin page, reached from the header's user area (and the menu sheet). */
export type AdminNavItem = {
  href: string;
  /** Visible label in the header (lg and up) and the menu sheet. */
  label: string;
  /** The label in the menu sheet, where there is room for the full name. */
  menuLabel: string;
  /** Accessible name in the header; contains the visible label (WCAG 2.5.3). */
  name: string;
  icon: LucideIcon;
  action: Action;
  /**
   * Passed to `<Link prefetch>`. `false` for pages whose render has side
   * effects (the audit log records each view), so a prefetch never renders them.
   */
  prefetch?: false;
};

export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin/staff", label: "Staff", menuLabel: "Staff", name: "Admin: Staff", icon: UserCog, action: "staff.view" },
  { href: "/admin/settings", label: "Settings", menuLabel: "OPD Settings", name: "Admin: OPD Settings", icon: Settings, action: "settings.view" },
  {
    href: "/admin/audit",
    label: "Audit",
    menuLabel: "Audit log",
    name: "Admin: Audit log",
    icon: ScrollText,
    action: "audit.view",
    prefetch: false,
  },
];

export function visibleAdminNav(allowed: readonly string[]): AdminNavItem[] {
  return ADMIN_NAV.filter((item) => allowed.includes(item.href));
}