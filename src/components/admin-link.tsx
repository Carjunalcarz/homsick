"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { visibleAdminNav } from "@/components/nav-items";
import { isActivePath } from "@/components/top-nav";
import { cn } from "@/lib/utils";

/** The header's Admin links (Admins only), each marked current on its page. */
export function AdminLinks({ allowedHrefs }: { allowedHrefs: readonly string[] }) {
  const pathname = usePathname();
  const items = visibleAdminNav(allowedHrefs);
  if (items.length === 0) return null;
  return (
    // Below md the Admin pages are in the menu sheet; three links don't fit a phone header.
    <nav aria-label="Admin" className="hidden items-center gap-1 md:flex">
      {items.map(({ href, label, name, icon: Icon, prefetch }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            prefetch={prefetch}
            aria-label={name}
            aria-current={active ? "page" : undefined}
            title={name}
            className={cn(
              "inline-flex h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded px-2 text-sm font-medium transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "text-primary" : "text-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
            <span className="hidden lg:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
