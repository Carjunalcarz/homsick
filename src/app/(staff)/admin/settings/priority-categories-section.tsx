"use client";

import { useState, useTransition } from "react";
import { Scale } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/action-result";
import { LEGALLY_REQUIRED } from "@/lib/clinical-settings";
import { cn } from "@/lib/utils";
import { setPriorityCategoryEnabledAction, type ClinicalActionData } from "@/server/settings/actions";
import { returnFocus } from "@/lib/focus";
import { NETWORK_ERROR } from "@/components/form-parts";
import { CARD, SectionHeader } from "./settings-ui";

export type PriorityCategoryData = {
  id: string;
  name: string;
  legalBasis: string;
  legallyRequired: boolean;
  enabled: boolean;
};

const switchId = (id: string) => `priority-${id}-switch`;

export function PriorityCategoriesSection({
  categories,
  canManage,
}: {
  categories: PriorityCategoryData[];
  canManage: boolean;
}) {
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<PriorityCategoryData | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const save = (category: PriorityCategoryData, enabled: boolean, confirmLegal: boolean, done?: () => void) => {
    setStatus("");
    setError(null);
    setSavingId(category.id);
    startTransition(async () => {
      let result: ActionResult<ClinicalActionData>;
      try {
        result = await setPriorityCategoryEnabledAction({ id: category.id, enabled, confirmLegal });
      } catch {
        setError(NETWORK_ERROR);
        setSavingId(null);
        return;
      }
      setSavingId(null);
      done?.();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setStatus(
        result.data.changed
          ? `${category.name} priority turned ${enabled ? "on" : "off"}.`
          : `${category.name} priority was already ${enabled ? "on" : "off"}.`,
      );
    });
  };

  return (
    <section aria-labelledby="priority-categories-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="priority-categories-heading"
        title="Priority Categories"
        description="Patients in an enabled category are served ahead of others at the same urgency."
        status={status}
      />
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      </div>
      <ul className={cn(CARD, "flex flex-col divide-y divide-border p-0")}>
        {categories.map((category) => (
          <li key={category.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={switchId(category.id)} className="text-base font-medium">
                {category.name}
              </label>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span id={`priority-${category.id}-basis`}>{category.legalBasis}</span>
                {category.legallyRequired && (
                  <span className="inline-flex h-6 items-center gap-1 rounded-full border border-priority/40 px-2.5 text-xs font-medium text-foreground [&>svg]:size-3.5">
                    <Scale aria-hidden="true" /> Legally required
                  </span>
                )}
              </div>
            </div>
            <div className="flex min-h-11 items-center gap-3">
              <span className="text-sm font-medium" aria-hidden="true">
                {category.enabled ? "On" : "Off"}
              </span>
              <Switch
                id={switchId(category.id)}
                checked={category.enabled}
                disabled={!canManage || savingId !== null}
                aria-describedby={`priority-${category.id}-basis`}
                className="after:absolute after:-inset-2.5 relative"
                onCheckedChange={(enabled) => {
                  if (!enabled && category.legallyRequired) {
                    setStatus("");
                    setError(null);
                    setConfirming(category);
                    setConfirmOpen(true);
                    return;
                  }
                  save(category, enabled, false);
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      {canManage && confirming && (
        <AlertDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            if (!open && savingId === null) setConfirmOpen(false);
          }}
        >
          <AlertDialogContent onCloseAutoFocus={(event) => returnFocus(event, switchId(confirming.id))}>
            <AlertDialogHeader>
              <AlertDialogTitle>Turn off {confirming.name} priority?</AlertDialogTitle>
              <AlertDialogDescription>
                <strong className="font-semibold text-foreground">{LEGALLY_REQUIRED}.</strong> {confirming.name}{" "}
                patients ({confirming.legalBasis}) will no longer get priority in new entries. Entries already made keep
                theirs.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11" disabled={savingId !== null}>
                Cancel
              </AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                className="h-11"
                disabled={savingId !== null}
                aria-busy={savingId !== null || undefined}
                onClick={() => save(confirming, false, true, () => setConfirmOpen(false))}
              >
                Turn off {confirming.name}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </section>
  );
}
