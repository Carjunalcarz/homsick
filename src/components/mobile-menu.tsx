"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { HeaderSearch } from "@/components/header-search";
import { visibleAdminNav, visibleNav } from "@/components/nav-items";
import { isActivePath } from "@/components/top-nav";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Menu sheet with the page nav and search. Shown below lg: below md it
 * replaces the hidden top nav, and from md to lg it is where search lives.
 */
export function MobileMenu({
  allowedHrefs,
  adminHrefs = [],
}: {
  /** The main nav items the user's Role may use. */
  allowedHrefs: readonly string[];
  /** The Admin pages the user may open. */
  adminHrefs?: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const adminItems = visibleAdminNav(adminHrefs);
  const pathname = usePathname();
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open navigation menu"
        className="inline-flex size-11 cursor-pointer items-center justify-center rounded text-foreground transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 p-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Main site navigation.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 overflow-y-auto p-4">
          <HeaderSearch id="mobile-search" onSubmit={close} />
          <nav aria-label="Main">
            <ul className="flex flex-col gap-1">
              {visibleNav(allowedHrefs).map(({ href, label, icon: Icon }) => {
                const active = isActivePath(pathname, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-11 cursor-pointer items-center gap-3 rounded px-3 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active ? "bg-primary/10 text-primary" : "hover:bg-muted"
                      )}
                    >
                      <Icon className="size-5" aria-hidden="true" />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {adminItems.length > 0 && (
            <nav aria-label="Admin">
              <p className="px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Admin</p>
              <ul className="flex flex-col gap-1">
                {adminItems.map(({ href, menuLabel, icon: Icon, prefetch }) => {
                  const active = isActivePath(pathname, href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        prefetch={prefetch}
                        onClick={close}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex h-11 cursor-pointer items-center gap-3 rounded px-3 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active ? "bg-primary/10 text-primary" : "hover:bg-muted"
                        )}
                      >
                        <Icon className="size-5" aria-hidden="true" />
                        {menuLabel}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
