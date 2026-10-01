// Pure display helpers for the audit log page (no server imports).

/** One changed field: `old → new`, or a single value shown as-is. */
export type ChangeLine =
  | { field: string; kind: "diff"; old: string; new: string }
  | { field: string; kind: "value"; value: string };

/** How a row's `changes` is shown. */
export type ChangesView =
  | { kind: "none" }
  | { kind: "raw"; text: string }
  | { kind: "fields"; lines: ChangeLine[] };

const EMPTY = "—";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A stored value as short text: strings as-is, lists of named things by name. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return EMPTY;
  if (typeof value === "string") return value === "" ? '""' : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    if (value.every((item) => isPlainObject(item) && typeof item.name === "string")) {
      return value.map((item) => (item as { name: string }).name).join(", ");
    }
    if (value.every((item) => typeof item === "string" || typeof item === "number")) return value.join(", ");
  }
  return JSON.stringify(value);
}

/** `{ old, new }` (and nothing else) is a change; anything else is a single value. */
function isDiff(value: unknown): value is { old: unknown; new: unknown } {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes("old") && keys.includes("new");
}

/** Turns a row's parsed `changes` into lines for the Changes column. */
export function describeChanges(changes: Record<string, unknown> | string | null): ChangesView {
  if (changes === null) return { kind: "none" };
  if (typeof changes === "string") return { kind: "raw", text: changes };
  const lines: ChangeLine[] = Object.entries(changes).map(([field, value]) =>
    isDiff(value)
      ? { field, kind: "diff", old: formatValue(value.old), new: formatValue(value.new) }
      : { field, kind: "value", value: formatValue(value) },
  );
  return lines.length === 0 ? { kind: "none" } : { kind: "fields", lines };
}
