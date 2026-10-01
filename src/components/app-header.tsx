import Link from "next/link";
import { Hospital, LogOut } from "lucide-react";
import { AdminLinks } from "@/components/admin-link";
import { HeaderSearch } from "@/components/header-search";
import { MobileMenu } from "@/components/mobile-menu";
import { SearchShortcut } from "@/components/search-shortcut";
import { allowedAdminNav, allowedNav } from "@/components/nav-permissions";
import { ThemeToggle } from "@/components/theme-toggle";
import { TopNav } from "@/components/top-nav";
import { roleLabel } from "@/lib/auth-messages";
import { HEADER_SEARCH_ID } from "@/lib/keyboard-shortcuts";
import { signOutAction } from "@/server/auth/actions";

export type HeaderUser = { name: string; role: string };

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/** White top bar from the reference design: logo, search, page nav, account. */
export function AppHeader({ user }: { user: HeaderUser }) {
  // Cosmetic only: every page checks its own permission.
  const allowedHrefs = allowedNav(user);
  const adminHrefs = allowedAdminNav(user);
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-3 md:h-[72px] md:gap-4 md:px-6 xl:gap-6">
      <MobileMenu allowedHrefs={allowedHrefs} adminHrefs={adminHrefs} />

      <Link
        href="/"
        aria-label="OPD overview"
        className="flex h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-9 items-center justify-center rounded bg-primary text-primary-foreground">
          <Hospital className="size-5" aria-hidden="true" />
        </span>
        <span className="text-base font-semibold tracking-tight md:hidden xl:inline">OPD</span>
      </Link>

      {/* Six nav items leave no room for the search at tablet width, so it
          shows from lg up; below lg it is in the menu sheet. */}
      <HeaderSearch id={HEADER_SEARCH_ID} className="hidden w-48 lg:block xl:w-64" />
      {/* Ctrl+K: the Patient finder on /triage, this search elsewhere. */}
      <SearchShortcut />

      <div className="hidden h-full min-w-0 flex-1 justify-center md:flex">
        <TopNav allowedHrefs={allowedHrefs} />
      </div>

      <div className="ml-auto flex items-center gap-2 md:ml-0">
        <ThemeToggle />
        <div className="flex items-center gap-2 border-l border-border pl-3">
          <AdminLinks allowedHrefs={adminHrefs} />
          <span
            aria-hidden="true"
            className="hidden size-9 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground xl:flex"
          >
            {initials(user.name)}
          </span>
          <span className="hidden flex-col leading-tight xl:flex">
            <span className="text-sm font-medium">{user.name}</span>
            <span className="text-xs text-muted-foreground">{roleLabel(user.role)}</span>
          </span>
          <form action={signOutAction}>
            <button
              type="submit"
              aria-label={`Sign out ${user.name}`}
              title="Sign out"
              className="inline-flex h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded px-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LogOut className="size-5" aria-hidden="true" />
              <span className="hidden lg:inline">Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
