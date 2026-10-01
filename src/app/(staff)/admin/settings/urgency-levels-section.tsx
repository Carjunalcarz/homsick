"use client";

import { useRef, useState, useTransition } from "react";
import { Pencil, Plus, Siren, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionResult } from "@/lib/action-result";
import { LEVEL_NAME_MAX, LEVEL_NAME_MIN, LEVEL_RANK_MAX, LEVELS_MAX, lowestFreeRank } from "@/lib/clinical-settings";
import { cn } from "@/lib/utils";
import { updateUrgencyLevelsAction, type ClinicalActionData } from "@/server/settings/actions";
import { describedBy, FIELD, FieldError, focusFirstInvalid, NETWORK_ERROR, splitErrors } from "@/components/form-parts";
import { CARD, EditSheet, SectionHeader, SheetForm, useReportPending } from "./settings-ui";

export type UrgencyLevelData = { id: string; name: string; isEr: boolean; rank: number | null };

const EDIT_BUTTON_ID = "urgency-levels-edit";

export function UrgencyLevelsSection({ levels, canManage }: { levels: UrgencyLevelData[]; canManage: boolean }) {
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <section aria-labelledby="urgency-levels-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="urgency-levels-heading"
        title="Urgency Levels"
        description="Triage picks one per patient. ER levels go to the ER; the rest are served by rank, lowest first."
        status={status}
      />
      <div className={cn(CARD, "flex flex-col gap-4")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Name</TableHead>
              <TableHead scope="col">Rank</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {levels.map((level) => (
              <TableRow key={level.id}>
                <TableCell className="h-11 font-medium whitespace-normal">{level.name}</TableCell>
                <TableCell className="tabular-nums">
                  {level.isEr ? (
                    <span className="inline-flex h-6 items-center gap-1 rounded-full border border-urgent/40 px-2.5 text-xs font-medium text-urgent [&>svg]:size-3.5">
                      <Siren aria-hidden="true" /> ER
                    </span>
                  ) : (
                    level.rank
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {canManage && (
          <div>
            <Button
              id={EDIT_BUTTON_ID}
              type="button"
              variant="outline"
              className="h-11 px-4"
              onClick={() => {
                setStatus("");
                setOpen(true);
              }}
            >
              <Pencil aria-hidden="true" />
              Edit<span className="sr-only"> Urgency Levels</span>
            </Button>
          </div>
        )}
      </div>

      {canManage && (
        <EditSheet open={open} returnFocusId={EDIT_BUTTON_ID} onClose={() => setOpen(false)}>
          {(onPendingChange) => (
            <UrgencyLevelsForm
              levels={levels}
              onPendingChange={onPendingChange}
              onSaved={(changed) => {
                setOpen(false);
                setStatus(changed ? "Urgency Levels saved." : "No changes to Urgency Levels.");
              }}
            />
          )}
        </EditSheet>
      )}
    </section>
  );
}

type Row = { key: string; id?: string; name: string; isEr: boolean; rank: string };

/** Ranks the non-ER rows use, except the row `exceptKey`. */
function ranksInUse(rows: Row[], exceptKey?: string): number[] {
  return rows
    .filter((row) => !row.isEr && row.key !== exceptKey && row.rank.trim() !== "")
    .map((row) => Number(row.rank))
    .filter(Number.isInteger);
}

/** The lowest free rank as form text, or "" when every rank is taken. */
function freeRank(used: number[]): string {
  const rank = lowestFreeRank(used);
  return rank === null ? "" : String(rank);
}

function UrgencyLevelsForm({
  levels,
  onPendingChange,
  onSaved,
}: {
  levels: UrgencyLevelData[];
  onPendingChange: (pending: boolean) => void;
  onSaved: (changed: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    levels.map((level) => ({
      key: level.id,
      id: level.id,
      name: level.name,
      isEr: level.isEr,
      rank: level.rank === null ? "" : String(level.rank),
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  useReportPending(pending, onPendingChange);
  const atMax = rows.length >= LEVELS_MAX;

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const setEr = (key: string, isEr: boolean) =>
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        if (isEr) return { ...row, isEr };
        // Back to a ranked level: keep its rank if still free, else the lowest free one.
        const used = ranksInUse(current, key);
        const rank = Number(row.rank);
        return { ...row, isEr, rank: row.rank !== "" && !used.includes(rank) ? row.rank : freeRank(used) };
      }),
    );

  const addLevel = () => {
    const key = `new-${crypto.randomUUID()}`;
    setRows((current) => [...current, { key, name: "", isEr: false, rank: freeRank(ranksInUse(current)) }]);
    setErrors({});
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`#level-${key}-name`)?.focus());
  };

  const removeLevel = (key: string) => {
    setRows((current) => current.filter((row) => row.key !== key));
    setErrors({});
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("#urgency-add")?.focus());
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const submitted = rows;
    startTransition(async () => {
      let result: ActionResult<ClinicalActionData>;
      try {
        result = await updateUrgencyLevelsAction({
          levels: submitted.map((row) => ({
            ...(row.id ? { id: row.id } : {}),
            name: row.name,
            isEr: row.isEr,
            rank: row.isEr ? null : row.rank,
          })),
        });
      } catch {
        setFormError(NETWORK_ERROR);
        return;
      }
      if (result.ok) {
        setErrors({});
        onSaved(result.data.changed);
        return;
      }
      const split = splitErrors(result.error, (key) => /^levels\.\d+\.(name|rank)$/.test(key));
      // Keys use the submitted row index; map them to the row keys shown.
      const byRow: Record<string, string> = {};
      for (const [key, message] of Object.entries(split.fieldErrors)) {
        const [, index, field] = key.split(".");
        const row = submitted[Number(index)];
        if (row) byRow[`${row.key}.${field}`] = message;
      }
      setErrors(byRow);
      setFormError(split.formError);
      focusFirstInvalid(formRef.current);
    });
  };

  return (
    <SheetForm
      formRef={formRef}
      title="Edit Urgency Levels"
      description="Changes apply to new triage entries only."
      formError={formError}
      pending={pending}
      onSubmit={submit}
    >
      <p id="urgency-rank-help" className="text-sm text-muted-foreground">
        Names are {LEVEL_NAME_MIN}–{LEVEL_NAME_MAX} characters. Ranks run from 1 (served first) to {LEVEL_RANK_MAX}.
        ER levels have no rank. Keep at least one level that isn&apos;t ER.
      </p>
      <ol className="flex flex-col gap-3">
        {rows.map((row, i) => {
          const nameError = errors[`${row.key}.name`];
          const rankError = errors[`${row.key}.rank`];
          const label = row.name.trim() || `level ${i + 1}`;
          return (
            <li key={row.key}>
              <fieldset className="flex flex-col gap-3 rounded border border-border p-3">
                <legend className="px-1 text-sm font-medium">Level {i + 1}</legend>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`level-${row.key}-name`} className="text-sm font-medium">
                    Name
                  </label>
                  <input
                    id={`level-${row.key}-name`}
                    type="text"
                    autoComplete="off"
                    maxLength={LEVEL_NAME_MAX}
                    value={row.name}
                    onChange={(e) => update(row.key, { name: e.target.value })}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={describedBy(null, `level-${row.key}-name-error`, nameError)}
                    className={FIELD}
                  />
                  <FieldError id={`level-${row.key}-name-error`} message={nameError} />
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label
                    htmlFor={`level-${row.key}-er`}
                    className="flex h-11 cursor-pointer items-center gap-2 rounded border border-input px-3 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                  >
                    <input
                      id={`level-${row.key}-er`}
                      type="checkbox"
                      checked={row.isEr}
                      onChange={(e) => setEr(row.key, e.target.checked)}
                      className="size-4 accent-primary focus-visible:outline-none"
                    />
                    ER
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`level-${row.key}-rank`} className="text-sm font-medium">
                      Rank
                    </label>
                    <input
                      id={`level-${row.key}-rank`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={LEVEL_RANK_MAX}
                      step={1}
                      disabled={row.isEr}
                      placeholder={row.isEr ? "ER" : undefined}
                      value={row.isEr ? "" : row.rank}
                      onChange={(e) => update(row.key, { rank: e.target.value })}
                      aria-invalid={rankError ? true : undefined}
                      aria-describedby={describedBy("urgency-rank-help", `level-${row.key}-rank-error`, rankError)}
                      className={cn(FIELD, "w-24 tabular-nums")}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="ml-auto h-11 px-3"
                    onClick={() => removeLevel(row.key)}
                  >
                    <Trash2 aria-hidden="true" />
                    Remove<span className="sr-only"> {label}</span>
                  </Button>
                </div>
                <FieldError id={`level-${row.key}-rank-error`} message={rankError} />
              </fieldset>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-1.5">
        <div>
          <Button
            id="urgency-add"
            type="button"
            variant="outline"
            className="h-11 px-4"
            disabled={atMax}
            aria-describedby={atMax ? "urgency-add-limit" : undefined}
            onClick={addLevel}
          >
            <Plus aria-hidden="true" />
            Add level
          </Button>
        </div>
        {atMax && (
          <p id="urgency-add-limit" className="text-sm text-muted-foreground">
            You have {LEVELS_MAX} levels, the most allowed. Remove one to add another.
          </p>
        )}
      </div>
    </SheetForm>
  );
}
