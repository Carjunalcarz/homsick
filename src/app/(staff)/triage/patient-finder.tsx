"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Search, UserPlus } from "lucide-react";
import { formatAge } from "@/lib/age";
import { PATIENT_FINDER_INPUT_ID } from "@/lib/keyboard-shortcuts";
import { formatLastVisit, PATIENT_SEARCH_HINT, PATIENT_SEARCH_PLACEHOLDER } from "@/lib/patient-display";
import { SEX_LABELS } from "@/lib/patient-name";
import { buildListHref, MAX_QUERY_LENGTH } from "@/lib/url-query";
import { cn } from "@/lib/utils";
import { searchPatientsAction, type PatientFinderRow } from "@/server/patients/actions";

/** Results update this long after the last keystroke. */
export const FINDER_DELAY_MS = 300;

const LISTBOX_ID = "patient-finder-listbox";
const HELP_ID = "patient-finder-help";
const optionId = (index: number) => `patient-finder-option-${index}`;
export const NEW_PATIENT_OPTION_ID = "patient-finder-new-patient";

type Results = { q: string; rows: PatientFinderRow[]; total: number };
type Failure = { q: string; message: string };

/**
 * The Patient finder (UX-DR9): an ARIA combobox. Results come from a Server
 * Action 300 ms after typing (at most 8); ↑/↓ move the highlight, Enter
 * selects, Esc clears. Ctrl+K focuses it (see SearchShortcut).
 *
 * With `onNewPatient` (users who may register), a "New patient" option is
 * always last, also when nothing matches; with an empty query, ↓ opens the
 * list on it. Choosing it passes the current query (for the name prefill).
 */
export function PatientFinder({
  onSelect,
  onNewPatient,
}: {
  onSelect: (patient: PatientFinderRow) => void;
  onNewPatient?: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // Each search gets a number; only the latest one's answer is shown.
  const latest = useRef(0);

  const q = query.trim();

  useEffect(() => {
    if (!q) return;
    const request = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        const result = await searchPatientsAction({ q });
        if (request !== latest.current) return;
        if (result.ok) {
          setResults({ q, rows: result.data.rows, total: result.data.total });
          setFailure(null);
        } else {
          setFailure({ q, message: result.error.message });
        }
      } catch {
        if (request !== latest.current) return;
        setFailure({ q, message: "Couldn't reach the server. Check the connection and try again." });
      }
    }, FINDER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [q]);

  const current = results && results.q === q ? results : null;
  const failed = failure && failure.q === q ? failure : null;
  const rows = current?.rows ?? [];
  const pending = q !== "" && !current && !failed;
  const newRow = onNewPatient !== undefined;
  const optionCount = rows.length + (newRow ? 1 : 0);
  // With a query, the list shows once its answer is in; without one, only after ↓/↑.
  const expanded = open && optionCount > 0 && (q === "" ? active >= 0 : !pending);
  const activeId = active >= rows.length ? NEW_PATIENT_OPTION_ID : optionId(active);

  function clear() {
    latest.current++;
    setQuery("");
    setResults(null);
    setFailure(null);
    setActive(-1);
    setOpen(false);
    setAnnouncement("");
  }

  function select(index: number) {
    const patient = rows[index];
    if (!patient) return;
    setActive(index);
    setOpen(false);
    setAnnouncement(`Selected ${patient.name}.`);
    onSelect(patient);
  }

  function chooseNewPatient() {
    if (!onNewPatient) return;
    setOpen(false);
    setActive(-1);
    onNewPatient(q);
  }

  function choose(index: number) {
    if (index >= rows.length) chooseNewPatient();
    else select(index);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // While a search is pending, only the rows of the settled answer can be moved through.
    const count = q !== "" && pending ? 0 : optionCount;
    switch (event.key) {
      case "ArrowDown":
        if (count === 0) return;
        event.preventDefault();
        setOpen(true);
        setActive((index) => (!expanded || index < 0 ? 0 : Math.min(index + 1, count - 1)));
        break;
      case "ArrowUp":
        if (count === 0) return;
        event.preventDefault();
        setOpen(true);
        setActive((index) => (!expanded || index < 0 ? count - 1 : Math.max(index - 1, 0)));
        break;
      case "Enter":
        if (expanded && active >= 0) {
          event.preventDefault();
          choose(active);
        }
        break;
      case "Escape":
        if (query !== "" || open) {
          event.preventDefault();
          clear();
        }
        break;
    }
  }

  let status = "";
  if (pending) status = "Searching…";
  else if (failed) status = failed.message;
  else if (current && rows.length === 0) status = `No patients match "${q}".`;
  else if (current) {
    status =
      current.total > rows.length
        ? `${current.total} patients found. Showing the first ${rows.length}; type more to narrow.`
        : current.total === 1
          ? "1 patient found."
          : `${current.total} patients found.`;
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={PATIENT_FINDER_INPUT_ID} className="text-sm font-medium">
        Find patient
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          id={PATIENT_FINDER_INPUT_ID}
          type="text"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? activeId : undefined}
          aria-describedby={HELP_ID}
          aria-keyshortcuts="Control+K"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_QUERY_LENGTH}
          placeholder={PATIENT_SEARCH_PLACEHOLDER}
          value={query}
          onChange={(event) => {
            const text = event.target.value;
            setQuery(text);
            setActive(-1);
            setOpen(true);
            setAnnouncement("");
            if (!text.trim()) latest.current++;
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          // Leaving the combobox closes the list (an option click keeps focus: see onMouseDown).
          onBlur={() => setOpen(false)}
          className="h-11 w-full min-w-0 rounded-lg border border-input bg-card pr-20 pl-9 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
        <span className="pointer-events-none absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-2">
          {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />}
          <kbd aria-hidden="true" className="hidden rounded border border-border px-1.5 font-mono text-xs text-muted-foreground sm:inline">
            Ctrl K
          </kbd>
        </span>
      </div>
      <p id={HELP_ID} className="text-xs text-muted-foreground">
        ↑ and ↓ move through the results, Enter selects, Esc clears.
        {newRow && " The last option, New patient, registers someone not found."}
      </p>

      <div role="status" aria-live="polite" aria-atomic="true" className="min-h-5 text-sm text-muted-foreground">
        {announcement || status}
      </div>
      {current && current.total > rows.length && (
        <Link
          href={buildListHref("/patients", { q: current.q })}
          className="inline-flex h-11 cursor-pointer items-center self-start rounded-lg px-3 text-sm font-medium text-primary transition-colors duration-200 hover:bg-muted hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          See all {current.total} results
        </Link>
      )}
      {failed === null && current && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{PATIENT_SEARCH_HINT}</p>
      )}

      <ul
        id={LISTBOX_ID}
        role="listbox"
        aria-label="Matching patients"
        hidden={!expanded}
        className="flex flex-col gap-1 rounded-lg border border-border bg-card p-1"
      >
        {rows.map((patient, index) => (
          <li
            key={patient.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            // Keep focus in the input; the click selects.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => select(index)}
            className={cn(
              "flex min-h-11 cursor-pointer flex-col justify-center gap-0.5 rounded px-3 py-2 text-sm",
              index === active ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted",
            )}
          >
            <span className="font-medium">{patient.name}</span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{formatAge(patient.age)}</span>
              <span aria-hidden="true">·</span>
              <span>{SEX_LABELS[patient.sex]}</span>
              <span aria-hidden="true">·</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{patient.hospitalNumber}</span>
              <span aria-hidden="true">·</span>
              <span>{formatLastVisit(patient.lastVisit)}</span>
            </span>
          </li>
        ))}
        {newRow && (
          <li
            id={NEW_PATIENT_OPTION_ID}
            role="option"
            aria-selected={active === rows.length}
            onMouseDown={(event) => event.preventDefault()}
            onClick={chooseNewPatient}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm font-medium text-primary",
              rows.length > 0 && "border-t border-border",
              active === rows.length ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted",
            )}
          >
            <UserPlus className="size-4 shrink-0" aria-hidden="true" />
            New patient
          </li>
        )}
      </ul>
    </div>
  );
}
