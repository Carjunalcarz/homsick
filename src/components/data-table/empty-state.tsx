import Link from "next/link";
import { SearchX } from "lucide-react";

/** Shown in place of the table when no rows match the search and filters. */
export function DataTableEmptyState({
  title,
  hint,
  clearHref,
  clearLabel = "Clear filters",
}: {
  /** e.g. `No staff match "ana"`. */
  title: React.ReactNode;
  /** One line on how to widen the search. */
  hint?: React.ReactNode;
  /** Link back to the unfiltered list; omit when nothing is filtered. */
  clearHref?: string;
  clearLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <SearchX className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {clearHref && (
        <Link
          href={clearHref}
          className="inline-flex h-11 cursor-pointer items-center rounded-lg px-4 text-sm font-medium text-primary transition-colors duration-200 hover:bg-muted hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {clearLabel}
        </Link>
      )}
    </div>
  );
}
