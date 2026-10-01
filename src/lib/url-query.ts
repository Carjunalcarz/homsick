// URL state for list pages (search, filter selects, page). Safe to import in
// client code: it has no server or data imports.

import { isOpdDate } from "./time";

export const MAX_QUERY_LENGTH = 100;

export type SearchParams = Record<string, string | string[] | undefined>;

/** One select filter: the allowed values and the one used when the URL has none. */
export type FilterSpec<V extends string = string> = {
  readonly values: readonly V[];
  readonly default: V;
};

/** The filters a list page accepts, keyed by URL parameter name. */
export type ListSchema = {
  readonly filters: Readonly<Record<string, FilterSpec>>;
};

export type ListParams<S extends ListSchema> = {
  q: string;
  page: number;
} & { [K in keyof S["filters"]]: S["filters"][K]["values"][number] };

/** Values that go into a list URL. Empty strings and `undefined` are left out. */
export type ListValues = Record<string, string | number | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** Trims and shortens a search string to the allowed length. */
export function normalizeQuery(value: string | undefined) {
  return (value ?? "").trim().slice(0, MAX_QUERY_LENGTH).trim();
}

/** Reads a positive integer page number; anything else is page 1. */
export function parsePage(value: string | undefined) {
  if (value === undefined || !/^\d+$/.test(value.trim())) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

/** Keeps a requested page within 1..pageCount (an empty list still has page 1). */
export function clampPage(page: number, pageCount: number) {
  return Math.min(Math.max(1, page), Math.max(1, pageCount));
}

/** The default values of a schema: empty search, page 1, each filter's default. */
export function listDefaults<S extends ListSchema>(schema: S): ListParams<S> {
  const values: Record<string, string | number> = { q: "", page: 1 };
  for (const [name, spec] of Object.entries(schema.filters)) values[name] = spec.default;
  return values as ListParams<S>;
}

/**
 * Turns URL search params into list parameters. Unknown or malformed values
 * fall back to the defaults instead of erroring, so a hand-edited URL still
 * shows the list.
 */
export function parseListParams<S extends ListSchema>(
  searchParams: SearchParams,
  schema: S
): ListParams<S> {
  const values: Record<string, string | number> = {
    q: normalizeQuery(first(searchParams.q)),
    page: parsePage(first(searchParams.page)),
  };
  for (const [name, spec] of Object.entries(schema.filters)) {
    const raw = first(searchParams[name]);
    values[name] = raw !== undefined && spec.values.includes(raw) ? raw : spec.default;
  }
  return values as ListParams<S>;
}

/** A date range filter: Manila dates (`YYYY-MM-DD`), each optional ("" = open). */
export type DateRange = { from: string; to: string };

/**
 * Reads an optional `from`/`to` date range: an invalid date is ignored (""),
 * and a reversed range is swapped so `from <= to`.
 */
export function parseDateRange(
  from: string | string[] | undefined,
  to: string | string[] | undefined
): DateRange {
  const clean = (value: string | string[] | undefined) => {
    const raw = (first(value) ?? "").trim();
    return isOpdDate(raw) ? raw : "";
  };
  const a = clean(from);
  const b = clean(to);
  return a && b && a > b ? { from: b, to: a } : { from: a, to: b };
}

/**
 * Builds a list URL, leaving out every value equal to its default (and empty
 * values), so the plain path is the canonical URL of the default view.
 */
export function buildListHref(basePath: string, values: ListValues, defaults: ListValues = {}) {
  const params = new URLSearchParams();
  // `page` always goes last, so equal views get the same URL.
  const { page, ...rest } = values;
  for (const [name, value] of [...Object.entries(rest), ["page", page] as const]) {
    if (value === undefined || value === "") continue;
    const fallback = name === "page" ? (defaults.page ?? 1) : defaults[name];
    if (String(value) === String(fallback)) continue;
    params.set(name, String(value));
  }
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}
