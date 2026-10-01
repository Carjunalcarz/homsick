"use client";

import { useRef, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { updateClinicalScheduleAction, type ClinicalActionData } from "@/server/settings/actions";
import { describedBy, FIELD, FieldError, focusFirstInvalid, NETWORK_ERROR, splitErrors } from "@/components/form-parts";
import { CARD, EditSheet, SectionHeader, SheetForm, useReportPending } from "./settings-ui";

export type ScheduleData = { id: string; name: string; days: number[] };

export const formatScheduleDays = (days: number[]) => `Day ${days.join(", ")}`;

const editButtonId = (id: string) => `schedule-${id}-edit`;

export function SchedulesSection({ schedules, canManage }: { schedules: ScheduleData[]; canManage: boolean }) {
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<ScheduleData | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <section aria-labelledby="schedules-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="schedules-heading"
        title="Animal Bite Center schedules"
        description="Dose days counted from the first dose (Day 0). Used for new vaccination series only."
        status={status}
      />
      <ul className="grid gap-4 md:grid-cols-2">
        {schedules.map((schedule) => (
          <li key={schedule.id}>
            <article
              aria-labelledby={`schedule-${schedule.id}-name`}
              className={cn(CARD, "flex h-full flex-col gap-3")}
            >
              <h3 id={`schedule-${schedule.id}-name`} className="text-base font-medium">
                {schedule.name}
              </h3>
              <p className="text-sm tabular-nums">{formatScheduleDays(schedule.days)}</p>
              {canManage && (
                <div className="mt-auto">
                  <Button
                    id={editButtonId(schedule.id)}
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
                    onClick={() => {
                      setStatus("");
                      setEditing(schedule);
                      setOpen(true);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                    Edit<span className="sr-only"> {schedule.name} schedule</span>
                  </Button>
                </div>
              )}
            </article>
          </li>
        ))}
      </ul>

      {canManage && editing && (
        <EditSheet open={open} returnFocusId={editButtonId(editing.id)} onClose={() => setOpen(false)}>
          {(onPendingChange) => (
            <ScheduleForm
              schedule={editing}
              onPendingChange={onPendingChange}
              onSaved={(changed) => {
                setOpen(false);
                setStatus(changed ? `${editing.name} schedule saved.` : `No changes to ${editing.name} schedule.`);
              }}
            />
          )}
        </EditSheet>
      )}
    </section>
  );
}

function ScheduleForm({
  schedule,
  onPendingChange,
  onSaved,
}: {
  schedule: ScheduleData;
  onPendingChange: (pending: boolean) => void;
  onSaved: (changed: boolean) => void;
}) {
  const [days, setDays] = useState(schedule.days.join(", "));
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  useReportPending(pending, onPendingChange);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    startTransition(async () => {
      let result: ActionResult<ClinicalActionData>;
      try {
        result = await updateClinicalScheduleAction({ id: schedule.id, days });
      } catch {
        setFormError(NETWORK_ERROR);
        return;
      }
      if (result.ok) {
        setError(undefined);
        onSaved(result.data.changed);
        return;
      }
      const split = splitErrors(result.error, (key) => key === "days");
      setError(split.fieldErrors.days);
      setFormError(split.formError);
      focusFirstInvalid(formRef.current);
    });
  };

  return (
    <SheetForm
      formRef={formRef}
      title={`Edit ${schedule.name} schedule`}
      description="Changes apply to new vaccination series only."
      formError={formError}
      pending={pending}
      onSubmit={submit}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="schedule-days" className="text-sm font-medium">
          Dose days
        </label>
        <input
          id="schedule-days"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy("schedule-days-help", "schedule-days-error", error)}
          className={cn(FIELD, "tabular-nums")}
        />
        <p id="schedule-days-help" className="text-sm text-muted-foreground">
          Comma-separated, starting at 0, e.g. 0, 3, 7. 2 to 10 doses, up to Day 90.
        </p>
        <FieldError id="schedule-days-error" message={error} />
      </div>
    </SheetForm>
  );
}
