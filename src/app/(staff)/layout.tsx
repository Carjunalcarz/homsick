import { AppHeader } from "@/components/app-header";
import { SessionGuard } from "@/components/session-guard";
import { sessionTiming } from "@/server/auth/session-config";
import { requireStaff } from "@/server/auth/session";

/** Shell for every staff page: sign-in check, skip link, header, <main>. */
export default async function StaffLayout({ children }: LayoutProps<"/">) {
  const user = await requireStaff();
  const timing = sessionTiming();

  return (
    // data-session-shell: the session guard makes this inert while signed out.
    <div data-session-shell="" className="flex min-h-full flex-1 flex-col">
      <a
        href="#content"
        className="sr-only z-50 rounded bg-card px-4 py-3 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <AppHeader user={{ name: user.name, role: user.role }} />
      <SessionGuard
        userId={user.id}
        userName={user.name}
        sessionSeconds={timing.expiresIn}
        warnSeconds={timing.warnSeconds}
        keepAliveSeconds={timing.updateAge}
      />
      {/* The left rail returns in Story 4.1 with one tile per live Facility. */}
      <div className="flex flex-1">
        {/* min-w-0 lets wide content (tables) scroll inside its own container
            instead of widening the page. */}
        <main id="content" className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
