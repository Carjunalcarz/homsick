"use client";

import { useEffect, useEffectEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import {
  initialToolbarState,
  pendingSearch,
  recordPush,
  sameUrlValues,
  syncToolbarState,
  type ToolbarUrlValues,
} from "@/components/data-table/toolbar-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isOpdDate } from "@/lib/time";
import { buildListHref, MAX_QUERY_LENGTH } from "@/lib/url-query";

export const SEARCH_DELAY_MS = 300;

export type DataTableFilter = {
  /** URL parameter name. Must not be `q` or `page`. */
  name: string;
  label: string;
  options: { value: string; label: string }[];
  /** The value left out of the URL. */
  defaultValue: string;
  /** The current value, from the URL. */
  value: string;
};

/** An optional date input (`YYYY-MM-DD`); empty means no limit and is left out of the URL. */
export type DataTableDateFilter = {
  /** URL parameter name, e.g. `from`. Must not be `q`, `page` or a select's name. */
  name: string;
  label: string;
  /** The current value from the URL, or "". */
  value: string;
};

/**
 * Whether a date input's value is ready to go into the URL: cleared, or a
 * date the server accepts (`isOpdDate`: years 1900–9998). Typing "2026" into
 * the year passes through 0002, 0020 and 0202 first; those never go out.
 */
function sameDates(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? "") !== (b[key] ?? "")) return false;
  return true;
}

export function isCommittableDate(value: string) {
  return value === "" || isOpdDate(value);
}

/**
 * Search box and filter selects for a list page. It only updates the URL
 * (debounced for typing); the page reads the URL and filters on the server.
 * When the URL changes from outside (back/forward or a link), the controls
 * follow it.
 */
export function DataTableToolbar({
  basePath,
  id,
  label,
  searchLabel = "Search",
  searchPlaceholder,
  q,
  filters = [],
  dateFilters = [],
}: {
  /** The list page's path, e.g. "/admin/staff". */
  basePath: string;
  /** Prefix for element ids; unique on the page. */
  id: string;
  /** Accessible name of the search region, e.g. "Filter staff". */
  label: string;
  searchLabel?: string;
  searchPlaceholder?: string;
  /** The current search text, from the URL. */
  q: string;
  filters?: DataTableFilter[];
  /** Optional date inputs (e.g. a from/to range): debounced like search, pushed as history entries. */
  dateFilters?: DataTableDateFilter[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // The URL values; a date's default is "".
  const urlDates: Record<string, string> = Object.fromEntries(dateFilters.map((date) => [date.name, date.value]));
  const url: ToolbarUrlValues = {
    q,
    filters: { ...Object.fromEntries(filters.map((filter) => [filter.name, filter.value])), ...urlDates },
  };
  const [state, setState] = useState(() => initialToolbarState(url));
  const [prevUrl, setPrevUrl] = useState(url);
  // What the date inputs show, and the dates the URL holds or is about to hold.
  const [dates, setDates] = useState(urlDates);
  const [syncedDates, setSyncedDates] = useState(urlDates);

  // Follow outside URL changes by adjusting state during render (not in an
  // effect), so the controls never show stale values for a frame.
  if (!sameUrlValues(prevUrl, url)) {
    setPrevUrl(url);
    setState(syncToolbarState(state, url));
    // The toolbar's own date push landing keeps the inputs; anything else is followed.
    if (!sameDates(urlDates, syncedDates)) {
      setDates(urlDates);
      setSyncedDates(urlDates);
    }
  }

  const defaults: Record<string, string | number> = { q: "", page: 1 };
  for (const filter of filters) defaults[filter.name] = filter.defaultValue;
  for (const date of dateFilters) defaults[date.name] = "";

  /** The dates to put in the URL: a date still being typed keeps the URL's value. */
  function committedDates(values: Readonly<Record<string, string>>): Record<string, string> {
    return Object.fromEntries(
      dateFilters.map((date) => {
        const value = values[date.name] ?? "";
        return [date.name, isCommittableDate(value) ? value : (syncedDates[date.name] ?? "")];
      })
    );
  }

  /**
   * Go to the list with these values, back on page 1. Select changes, date
   * changes and Clear are history entries (`push`), so back/forward steps
   * through them; debounced typing replaces the entry instead of adding one
   * per pause. The dates shown go along (once complete).
   */
  function navigate(
    nextQ: string,
    nextFilters: Readonly<Record<string, string>>,
    nextDates: Readonly<Record<string, string>>,
    mode: "push" | "replace"
  ) {
    const committed = committedDates(nextDates);
    setSyncedDates(committed);
    const href = buildListHref(basePath, { q: nextQ, ...nextFilters, ...committed, page: 1 }, defaults);
    startTransition(() => {
      if (mode === "push") router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    });
  }

  /** The select filters only (the state map may also carry the URL's dates). */
  const selectValues = () =>
    Object.fromEntries(filters.map((filter) => [filter.name, state.filters[filter.name] ?? filter.defaultValue]));

  // Debounce typing and date changes together, so every keystroke (or every
  // segment typed into a date input) doesn't trigger a server render (on the
  // audit log, each render records a view). One navigation after the pause
  // carries both; it is a history entry when a date changed.
  const pending = pendingSearch(state);
  const datesPending = !sameDates(committedDates(dates), syncedDates);
  const pendingKey = pending === null && !datesPending ? null : JSON.stringify([pending, datesPending ? dates : null]);

  const flush = useEffectEvent(() => {
    const text = state.q.trim();
    setState((current) => recordPush(current, text));
    navigate(text, selectValues(), dates, datesPending ? "push" : "replace");
  });

  useEffect(() => {
    if (pendingKey === null) return;
    const timer = setTimeout(() => flush(), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pendingKey]);

  const hasFilters =
    state.q.trim() !== "" ||
    filters.some((filter) => state.filters[filter.name] !== filter.defaultValue) ||
    dateFilters.some((date) => (dates[date.name] ?? "") !== "");

  return (
    <div
      role="search"
      aria-label={label}
      aria-busy={isPending}
      className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end"
    >
      <div className="flex flex-1 flex-col gap-1.5 md:min-w-56">
        <label htmlFor={`${id}-search`} className="text-sm font-medium">
          {searchLabel}
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id={`${id}-search`}
            type="search"
            value={state.q}
            onChange={(event) => {
              const text = event.target.value;
              setState((current) => ({ ...current, q: text }));
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && state.q) {
                setState((current) => ({ ...current, q: "" }));
              }
            }}
            placeholder={searchPlaceholder}
            autoComplete="off"
            maxLength={MAX_QUERY_LENGTH}
            className="h-11 bg-card pr-10 pl-9 text-base md:text-sm"
          />
          {isPending && (
            <Loader2
              className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      {filters.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:flex md:items-end">
          {filters.map((filter) => {
            const labelId = `${id}-${filter.name}-label`;
            return (
              <div key={filter.name} className="flex flex-col gap-1.5">
                <label id={labelId} className="text-sm font-medium">
                  {filter.label}
                </label>
                <Select
                  value={state.filters[filter.name] ?? filter.defaultValue}
                  onValueChange={(value) => {
                    const nextFilters = { ...state.filters, [filter.name]: value };
                    const trimmed = state.q.trim();
                    setState(recordPush({ ...state, filters: nextFilters }, trimmed));
                    navigate(trimmed, { ...selectValues(), [filter.name]: value }, dates, "push");
                  }}
                >
                  <SelectTrigger
                    aria-labelledby={labelId}
                    className="h-11! w-full cursor-pointer bg-card md:w-40"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filter.options.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className="min-h-11 cursor-pointer"
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      )}

      {dateFilters.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:flex md:items-end">
          {dateFilters.map((date) => {
            const inputId = `${id}-${date.name}`;
            return (
              <div key={date.name} className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={inputId} className="text-sm font-medium">
                  {date.label}
                </label>
                <Input
                  id={inputId}
                  type="date"
                  value={dates[date.name] ?? ""}
                  onChange={(event) => {
                    // Shown at once; pushed once after the pause (see pendingDatesKey).
                    const value = event.target.value;
                    setDates((current) => ({ ...current, [date.name]: value }));
                  }}
                  className="h-11 w-full min-w-0 cursor-pointer bg-card text-base md:w-40 md:text-sm"
                />
              </div>
            );
          })}
        </div>
      )}

      {hasFilters && (
        <Button
          type="button"
          variant="ghost"
          className="h-11 cursor-pointer self-start px-3 md:self-auto"
          onClick={() => {
            const cleared = Object.fromEntries(filters.map((filter) => [filter.name, filter.defaultValue]));
            const clearedDates = Object.fromEntries(dateFilters.map((date) => [date.name, ""]));
            setState(recordPush({ ...state, q: "", filters: { ...cleared, ...clearedDates } }, ""));
            setDates(clearedDates);
            navigate("", cleared, clearedDates, "push");
          }}
        >
          <X className="size-4" aria-hidden="true" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
