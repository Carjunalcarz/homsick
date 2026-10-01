import Form from "next/form";
import { Search } from "lucide-react";
import { MAX_QUERY_LENGTH } from "@/lib/url-query";
import { cn } from "@/lib/utils";

/**
 * Header search with the reference design's green underline. It submits to
 * /patients?q=..., so it works before JavaScript loads; next/form turns the
 * submit into a client-side navigation once it has.
 */
export function HeaderSearch({
  id,
  className,
  onSubmit,
}: {
  id: string;
  className?: string;
  /** Only passed from client components (e.g. to close the mobile menu). */
  onSubmit?: () => void;
}) {
  return (
    <Form
      action="/patients"
      role="search"
      aria-label="Search patients"
      onSubmit={onSubmit}
      className={cn("relative", className)}
    >
      <label htmlFor={id} className="sr-only">
        Search patients
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-1 size-4 -translate-y-1/2 text-search-accent"
        aria-hidden="true"
      />
      <input
        id={id}
        name="q"
        type="search"
        placeholder="Search patients..."
        autoComplete="off"
        maxLength={MAX_QUERY_LENGTH}
        className="h-11 w-full border-0 border-b-2 border-search-accent bg-transparent pr-2 pl-7 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary md:text-sm"
      />
    </Form>
  );
}
