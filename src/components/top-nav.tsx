"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { visibleNav } from "@/components/nav-items";
import { cn } from "@/lib/utils";

export function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Page links in the header: icon above label, active page in the brand color.
 * `allowedHrefs` are the items the user's Role may use; others are hidden.
 */
export function TopNav({ allowedHrefs }: { allowedHrefs: readonly string[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex h-full items-stretch gap-1">
      {visibleNav(allowedHrefs).map(({ href, label, icon: Icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-w-16 cursor-pointer flex-col items-center justify-center gap-1 px-2 text-xs xl:min-w-20 xl:px-3 font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
            {label}
            {/* Bar under the active item; shape, not only color, marks it. */}
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-x-3 bottom-0 h-0.5 rounded-full",
                active ? "bg-primary" : "bg-transparent"
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}
