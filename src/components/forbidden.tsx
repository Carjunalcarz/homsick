import Link from "next/link";
import { ShieldAlert } from "lucide-react";

/** The page title (`{Surface} | OPD`) for a page the user can't open. */
export const FORBIDDEN_TITLE = "No access";

/**
 * Shown in place of a page the user's Role can't open (UX-DR: permission
 * denied). It renders no data from the page: the page must not load any
 * before deciding to show this.
 */
export function Forbidden() {
  return (
    <section
      aria-labelledby="forbidden-title"
      className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 rounded-md bg-card p-6 shadow-[0_1px_3px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.04] dark:ring-white/[0.06] md:p-8"
    >
      <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
      <h1 id="forbidden-title" className="text-2xl font-light tracking-tight">
        You don&apos;t have access to this page.
      </h1>
      <Link
        href="/"
        className="inline-flex h-11 cursor-pointer items-center rounded bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Go to Overview
      </Link>
    </section>
  );
}
