"use client";

import { useCallback, useState, useTransition } from "react";
import { CircleCheck, CircleOff, Clock, Pencil, Power, PowerOff } from "lucide-react";
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
import type { ActionResult } from "@/lib/action-result";
import { formatHours, formatOpdDate, formatOpenDays } from "@/lib/facility-format";
import { cn } from "@/lib/utils";
import {
  deactivateFacilityAction,
  reactivateFacilityAction,
  type FacilityActionData,
} from "@/server/settings/actions";
import { FacilityForm, returnFocus } from "./facility-form";

/** One Facility as the settings page shows it. */
export type FacilityCardData = {
  id: string;
  name: string;
  /** The prefix in use today. */
  currentPrefix: string;
  /** A prefix change that starts on a later OPD day. */
  pending: { prefix: string; from: string } | null;
  openDays: number[];
  openTime: string;
  closeTime: string;
  isLive: boolean;
  active: boolean;
};

const NETWORK_ERROR = "Couldn't reach the server. Try again.";

/** Element ids of a card's buttons, so focus can return to them after a sheet or dialog closes. */
const editButtonId = (facilityId: string) => `facility-${facilityId}-edit`;
const toggleButtonId = (facilityId: string) => `facility-${facilityId}-toggle`;

type Confirming = { facility: FacilityCardData; kind: "deactivate" | "reactivate" };

export function FacilitiesSection({ facilities, canManage }: { facilities: FacilityCardData[]; canManage: boolean }) {
  const [status, setStatus] = useState("");
  // The last Facility edited or confirmed stays set while its sheet or
  // dialog animates closed; the open flags decide what is shown.
  const [editing, setEditing] = useState<FacilityCardData | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const onSaved = useCallback((name: string, changed: boolean) => {
    setEditOpen(false);
    setStatus(changed ? `${name} saved.` : `No changes to ${name}.`);
  }, []);

  return (
    <section aria-labelledby="facilities-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="facilities-heading" className="text-base font-medium">
            Facilities
          </h2>
          <p className="text-sm text-muted-foreground">
            Only live, active Facilities take patients. Deactivated ones stay in the records.
          </p>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className="min-h-5 text-sm font-medium">
          {status && (
            <>
              <CircleCheck className="mr-1 inline size-4 align-text-bottom text-success" aria-hidden="true" />
              {status}
            </>
          )}
        </p>
      </div>

      <ul className="grid gap-4 md:grid-cols-2">
        {facilities.map((facility) => (
          <li key={facility.id}>
            <FacilityCard
              facility={facility}
              canManage={canManage}
              onEdit={() => {
                setStatus("");
                setEditing(facility);
                setEditOpen(true);
              }}
              onToggleActive={() => {
                setStatus("");
                setConfirming({ facility, kind: facility.active ? "deactivate" : "reactivate" });
                setConfirmOpen(true);
              }}
            />
          </li>
        ))}
      </ul>

      {canManage && (
        <FacilityForm
          facility={editing}
          open={editOpen}
          returnFocusId={editing ? editButtonId(editing.id) : null}
          onClose={() => setEditOpen(false)}
          onSaved={onSaved}
        />
      )}
      {canManage && confirming && (
        <ConfirmActiveDialog
          key={`${confirming.facility.id}-${confirming.kind}`}
          confirming={confirming}
          open={confirmOpen}
          returnFocusId={toggleButtonId(confirming.facility.id)}
          onClose={() => setConfirmOpen(false)}
          onDone={(message) => {
            setConfirmOpen(false);
            setStatus(message);
          }}
        />
      )}
    </section>
  );
}

function FacilityCard({
  facility,
  canManage,
  onEdit,
  onToggleActive,
}: {
  facility: FacilityCardData;
  canManage: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  const headingId = `facility-${facility.id}-name`;
  return (
    <article
      aria-labelledby={headingId}
      className={cn(
        "flex h-full flex-col gap-4 rounded-md bg-card p-5 shadow-[0_1px_3px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.04] dark:ring-white/[0.06]",
        !facility.active && "bg-band",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="rounded bg-muted px-2 py-1 font-mono text-lg leading-none font-semibold">
          <span className="sr-only">Prefix </span>
          {facility.currentPrefix}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h3 id={headingId} className="text-base leading-snug font-medium">
            {facility.name}
          </h3>
          <div className="flex flex-wrap gap-2">
            {facility.isLive ? (
              <StatusBadge className="border-positive/40 text-positive">
                <CircleCheck aria-hidden="true" /> Live
              </StatusBadge>
            ) : (
              <StatusBadge className="border-border text-muted-foreground">
                <CircleOff aria-hidden="true" /> Not live
              </StatusBadge>
            )}
            {facility.active ? (
              <StatusBadge className="border-border text-foreground">Active</StatusBadge>
            ) : (
              <StatusBadge className="border-destructive/40 text-destructive">
                <PowerOff aria-hidden="true" /> Deactivated
              </StatusBadge>
            )}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Open days</dt>
        <dd>{formatOpenDays(facility.openDays)}</dd>
        <dt className="text-muted-foreground">Hours</dt>
        <dd className="tabular-nums">{formatHours(facility.openTime, facility.closeTime)}</dd>
      </dl>

      {facility.pending && (
        <p className="flex items-center gap-2 rounded border border-border bg-band px-3 py-2 text-sm">
          <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            Prefix changes to <span className="font-mono font-semibold">{facility.pending.prefix}</span> on{" "}
            {formatOpdDate(facility.pending.from)}
          </span>
        </p>
      )}

      {canManage && (
        <div className="mt-auto flex flex-wrap gap-2">
          {facility.active && (
            <Button id={editButtonId(facility.id)} type="button" variant="outline" className="h-11 px-4" onClick={onEdit}>
              <Pencil aria-hidden="true" />
              Edit<span className="sr-only"> {facility.name}</span>
            </Button>
          )}
          <Button
            id={toggleButtonId(facility.id)}
            type="button"
            variant="ghost"
            className="h-11 px-4"
            onClick={onToggleActive}
          >
            {facility.active ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
            {facility.active ? "Deactivate" : "Reactivate"}
            <span className="sr-only"> {facility.name}</span>
          </Button>
        </div>
      )}
    </article>
  );
}

function StatusBadge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs font-medium [&>svg]:size-3.5",
        className,
      )}
    >
      {children}
    </span>
  );
}

function ConfirmActiveDialog({
  confirming,
  open,
  returnFocusId,
  onClose,
  onDone,
}: {
  confirming: Confirming;
  open: boolean;
  returnFocusId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  /** Shown when the Facility was already in the requested state. */
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { facility, kind } = confirming;
  const deactivate = kind === "deactivate";

  const confirm = () => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      let result: ActionResult<FacilityActionData>;
      try {
        result = await (deactivate ? deactivateFacilityAction : reactivateFacilityAction)({ id: facility.id });
      } catch {
        setError(NETWORK_ERROR);
        return;
      }
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (!result.data.changed) {
        setNotice(`${facility.name} was already ${deactivate ? "deactivated" : "active"}.`);
        return;
      }
      onDone(`${facility.name} ${deactivate ? "deactivated" : "reactivated"}.`);
    });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !pending) {
          setError(null);
          setNotice(null);
          onClose();
        }
      }}
    >
      <AlertDialogContent onCloseAutoFocus={(event) => returnFocus(event, returnFocusId)}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {deactivate ? `Deactivate ${facility.name}?` : `Reactivate ${facility.name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deactivate
              ? `${facility.name} will be hidden from new assignments. Its records stay.`
              : `${facility.name} can take new assignments again${facility.isLive ? "" : " once it is live"}.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div role="alert" aria-live="assertive" aria-atomic="true">
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        </div>
        <div role="status" aria-live="polite" aria-atomic="true">
          {notice && <p className="text-sm font-medium">{notice}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11" disabled={pending}>
            Cancel
          </AlertDialogCancel>
          <Button
            type="button"
            variant={deactivate ? "destructive" : "default"}
            className="h-11"
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={confirm}
          >
            {deactivate ? `Deactivate ${facility.name}` : `Reactivate ${facility.name}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
