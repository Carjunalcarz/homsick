import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buildListHref, clampPage, type ListValues } from "@/lib/url-query";
import { cn } from "@/lib/utils";

const ITEM =
  "inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-3 text-sm font-medium tabular-nums transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const LINK = "cursor-pointer hover:bg-muted";
const DISABLED = "text-muted-foreground opacity-50";

/**
 * Page numbers to show: always the first and last page, plus the current page
 * and its neighbours. `null` marks a gap.
 */
export function pageItems(page: number, pageCount: number): (number | null)[] {
  const pages = new Set([1, pageCount, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const items: (number | null)[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) items.push(null);
    items.push(p);
  });
  return items;
}

/**
 * Page links for a list page. Each link keeps the current search and filters
 * (`values`) and changes only the page; defaults are left out of the URL.
 */
export function DataTablePagination({
  basePath,
  values,
  defaults,
  page: requestedPage,
  pageCount,
}: {
  basePath: string;
  /** The current search and filter values, without `page`. */
  values: ListValues;
  defaults?: ListValues;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  const page = clampPage(requestedPage, pageCount);

  const href = (p: number) => buildListHref(basePath, { ...values, page: p }, defaults);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-1 sm:justify-end">
      {page > 1 ? (
        <Link href={href(page - 1)} scroll={false} className={cn(ITEM, LINK)}>
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span>Previous</span>
        </Link>
      ) : (
        <span aria-disabled="true" className={cn(ITEM, DISABLED)}>
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span>Previous</span>
        </span>
      )}

      {/* Page numbers are hidden on small screens; "Page x of y" is shown instead. */}
      <ul className="hidden items-center gap-1 sm:flex">
        {pageItems(page, pageCount).map((p, i) =>
          p === null ? (
            <li key={`gap-${i}`} aria-hidden="true" className="px-1 text-muted-foreground">
              …
            </li>
          ) : (
            <li key={p}>
              <Link
                href={href(p)}
                scroll={false}
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
                className={cn(
                  ITEM,
                  p === page
                    ? "border border-border bg-card text-foreground"
                    : cn(LINK, "text-muted-foreground hover:text-foreground")
                )}
              >
                {p}
              </Link>
            </li>
          )
        )}
      </ul>
      <span className="px-2 text-sm text-muted-foreground tabular-nums sm:hidden">
        Page {page} of {pageCount}
      </span>

      {page < pageCount ? (
        <Link href={href(page + 1)} scroll={false} className={cn(ITEM, LINK)}>
          <span>Next</span>
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ) : (
        <span aria-disabled="true" className={cn(ITEM, DISABLED)}>
          <span>Next</span>
          <ChevronRight className="size-4" aria-hidden="true" />
        </span>
      )}
    </nav>
  );
}
