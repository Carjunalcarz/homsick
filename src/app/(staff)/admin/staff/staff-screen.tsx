"use client";

import { useState, useTransition } from "react";
import { DropdownMenu } from "radix-ui";
import {
  AlertCircle,
  CircleCheck,
  KeyRound,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  PowerOff,
} from "lucide-react";
import { DataTableEmptyState } from "@/components/data-table/empty-state";
import { DataTablePagination } from "@/components/data-table/pagination";
import { DataTableToolbar } from "@/components/data-table/toolbar";
import { ACTION_BUTTON, PageTitle } from "@/components/page-title";
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionResult } from "@/lib/action-result";
import { roleLabel } from "@/lib/auth-messages";
import { returnFocus } from "@/lib/focus";
import { cn } from "@/lib/utils";
import {
  deactivateStaffAction,
  reactivateStaffAction,
  unlockStaffAction,
  type StaffActionData,
} from "@/server/auth/staff-actions";
import { NETWORK_ERROR } from "@/components/form-parts";
import { PasswordSheet } from "./password-sheet";
import { StaffForm } from "./staff-form";
import {
  menuButtonId,
  NEW_BUTTON_ID,
  ROLE_ORDER,
  STATUS_LABELS,
  STATUS_ORDER,
  type FacilityOption,
  type PasswordLimits,
  type StaffRole,
  type StaffRowData,
  type StaffStatus,
} from "./staff-types";

const BASE_PATH = "/admin/staff";
const DEFAULTS = { q: "", role: "all", status: "all" };

const ROLE_OPTIONS = [
  { value: "all", label: "All" },
  ...ROLE_ORDER.map((value) => ({ value, label: roleLabel(value) })),
];
const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  ...STATUS_ORDER.map((value) => ({ value, label: STATUS_LABELS[value] })),
];

/** Facility Staff without an active Facility can't work any queue. */
function needsFacility(member: StaffRowData) {
  return member.role === "facility_staff" && !member.facilities.some((f) => f.active);
}

type Editing = { mode: "create" } | { mode: "edit"; member: StaffRowData };
type Confirming = { member: StaffRowData; kind: "deactivate" | "reactivate" };
type Status = { tone: "ok" | "error"; text: string } | null;

export function StaffScreen({
  rows,
  total,
  page,
  pageCount,
  q,
  role,
  status,
  facilities,
  currentUserId,
  canManage,
  passwordLimits,
}: {
  rows: StaffRowData[];
  total: number;
  page: number;
  pageCount: number;
  q: string;
  role: string;
  status: string;
  facilities: FacilityOption[];
  currentUserId: string;
  canManage: boolean;
  passwordLimits: PasswordLimits;
}) {
  const [message, setMessage] = useState<Status>(null);
  // The last target stays set while its sheet or dialog animates closed; the
  // open flags decide what is shown.
  const [editing, setEditing] = useState<Editing | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [passwordFor, setPasswordFor] = useState<StaffRowData | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Bumped each time the dialog opens, so it mounts fresh (no old error or notice).
  const [confirmSeq, setConfirmSeq] = useState(0);
  const [unlocking, startUnlock] = useTransition();

  const filtered = q !== "" || role !== "all" || status !== "all";
  const values = { q, role, status };

  const unlock = (member: StaffRowData) => {
    setMessage(null);
    startUnlock(async () => {
      let result: ActionResult<StaffActionData>;
      try {
        result = await unlockStaffAction({ id: member.id });
      } catch {
        setMessage({ tone: "error", text: NETWORK_ERROR });
        return;
      }
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error.message });
        return;
      }
      setMessage({
        tone: "ok",
        text: result.data.changed ? `${member.name} unlocked.` : `${member.name} was not locked.`,
      });
    });
  };

  return (
    <>
      <PageTitle
        title="Staff"
        description="Staff accounts, their Roles and Facilities. Deactivated accounts can't sign in; their records stay."
        action={
          canManage && (
            <button
              id={NEW_BUTTON_ID}
              type="button"
              onClick={() => {
                setMessage(null);
                setEditing({ mode: "create" });
                setEditOpen(true);
              }}
              className={cn(ACTION_BUTTON, "bg-success text-success-foreground hover:bg-success-hover")}
            >
              <Plus className="size-4" aria-hidden="true" />
              New staff account
            </button>
          )
        }
      />

      <section
        aria-labelledby="staff-list-heading"
        className="flex min-w-0 flex-col gap-4 rounded-md bg-card p-4 shadow-[0_1px_3px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.04] md:p-6 dark:ring-white/[0.06]"
      >
        <h2 id="staff-list-heading" className="sr-only">
          Staff accounts
        </h2>
        <DataTableToolbar
          basePath={BASE_PATH}
          id="staff"
          label="Filter staff"
          searchLabel="Search"
          searchPlaceholder="Name or username"
          q={q}
          filters={[
            {
              name: "role",
              label: "Role",
              defaultValue: "all",
              value: role,
              options: ROLE_OPTIONS,
            },
            {
              name: "status",
              label: "Status",
              defaultValue: "all",
              value: status,
              options: STATUS_OPTIONS,
            },
          ]}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-muted-foreground">
            {total === 1 ? "1 staff account" : `${total} staff accounts`}
            {filtered ? " match" : ""}
          </p>
          <div aria-live="polite" aria-atomic="true" className="min-h-5 text-sm font-medium">
            {message && (
              <p className={cn("flex items-center gap-1.5", message.tone === "error" && "text-destructive")}>
                {message.tone === "ok" ? (
                  <CircleCheck className="size-4 text-success" aria-hidden="true" />
                ) : (
                  <AlertCircle className="size-4" aria-hidden="true" />
                )}
                {message.text}
              </p>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <DataTableEmptyState
            title={q ? `No staff match "${q}"` : "No staff match these filters"}
            hint="Try another name or username, or clear the filters."
            clearHref={filtered ? BASE_PATH : undefined}
          />
        ) : (
          // The table scrolls in this one region on narrow screens (keyboard: focus it, then arrow keys).
          <div
            role="region"
            aria-labelledby="staff-list-heading"
            tabIndex={0}
            data-slot="table-container"
            className="relative min-w-0 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <table data-slot="table" className="w-full min-w-[720px] caption-bottom text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Name</TableHead>
                  <TableHead scope="col">Username</TableHead>
                  <TableHead scope="col">Role</TableHead>
                  <TableHead scope="col">Facilities</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  {canManage && (
                    <TableHead scope="col" className="w-14">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      {member.name}
                      {member.id === currentUserId && <span className="text-muted-foreground"> (you)</span>}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{member.username}</TableCell>
                    <TableCell>
                      <RoleBadge role={member.role} />
                    </TableCell>
                    <TableCell>
                      <FacilityChips facilities={member.facilities} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge status={member.status} />
                        {needsFacility(member) && (
                          <Pill className="border-warning/40 text-warning">
                            <AlertCircle aria-hidden="true" /> No active Facility
                          </Pill>
                        )}
                      </div>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <RowMenu
                          member={member}
                          isSelf={member.id === currentUserId}
                          busy={unlocking}
                          onEdit={() => {
                            setMessage(null);
                            setEditing({ mode: "edit", member });
                            setEditOpen(true);
                          }}
                          onSetPassword={() => {
                            setMessage(null);
                            setPasswordFor(member);
                            setPasswordOpen(true);
                          }}
                          onUnlock={() => unlock(member)}
                          onToggleActive={() => {
                            setMessage(null);
                            setConfirming({
                              member,
                              kind: member.status === "deactivated" ? "reactivate" : "deactivate",
                            });
                            setConfirmSeq((n) => n + 1);
                            setConfirmOpen(true);
                          }}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        )}

        <DataTablePagination basePath={BASE_PATH} values={values} defaults={DEFAULTS} page={page} pageCount={pageCount} />
      </section>

      {canManage && (
        <StaffForm
          editing={editing}
          currentUserId={currentUserId}
          open={editOpen}
          facilities={facilities}
          passwordLimits={passwordLimits}
          returnFocusId={editing?.mode === "edit" ? menuButtonId(editing.member.id) : NEW_BUTTON_ID}
          onClose={() => setEditOpen(false)}
          onSaved={(text) => {
            setEditOpen(false);
            setMessage({ tone: "ok", text });
          }}
        />
      )}
      {canManage && (
        <PasswordSheet
          member={passwordFor}
          open={passwordOpen}
          passwordLimits={passwordLimits}
          returnFocusId={passwordFor ? menuButtonId(passwordFor.id) : null}
          onClose={() => setPasswordOpen(false)}
          onSaved={(text) => {
            setPasswordOpen(false);
            setMessage({ tone: "ok", text });
          }}
        />
      )}
      {canManage && confirming && (
        <ConfirmActiveDialog
          key={confirmSeq}
          confirming={confirming}
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onDone={(text) => {
            setConfirmOpen(false);
            setMessage({ tone: "ok", text });
          }}
        />
      )}
    </>
  );
}

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3.5",
        className,
      )}
    >
      {children}
    </span>
  );
}

function RoleBadge({ role }: { role: StaffRole }) {
  return (
    <Pill className={role === "admin" ? "border-primary/40 text-primary" : "border-border text-foreground"}>
      {roleLabel(role)}
    </Pill>
  );
}

function StatusBadge({ status }: { status: StaffStatus }) {
  switch (status) {
    case "active":
      return (
        <Pill className="border-positive/40 text-positive">
          <CircleCheck aria-hidden="true" /> {STATUS_LABELS.active}
        </Pill>
      );
    case "locked":
      return (
        <Pill className="border-warning/40 text-warning">
          <Lock aria-hidden="true" /> {STATUS_LABELS.locked}
        </Pill>
      );
    case "deactivated":
      return (
        <Pill className="border-destructive/40 text-destructive">
          <PowerOff aria-hidden="true" /> {STATUS_LABELS.deactivated}
        </Pill>
      );
  }
}

/** Prefix chips; the Facility names are read out by screen readers. */
function FacilityChips({ facilities }: { facilities: FacilityOption[] }) {
  if (facilities.length === 0) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">None</span>
      </span>
    );
  }
  return (
    <ul className="flex flex-wrap gap-1">
      {facilities.map((facility) => (
        <li
          key={facility.id}
          title={facility.active ? facility.name : `${facility.name} (deactivated)`}
          className={cn(
            "rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold",
            !facility.active && "text-muted-foreground line-through",
          )}
        >
          <span aria-hidden="true">{facility.prefix}</span>
          <span className="sr-only">
            {facility.name}
            {facility.active ? "" : " (deactivated)"}
          </span>
        </li>
      ))}
    </ul>
  );
}

const MENU_ITEM =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded px-3 text-sm outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-muted [&>svg]:size-4 [&>svg]:shrink-0";

function RowMenu({
  member,
  isSelf,
  busy,
  onEdit,
  onSetPassword,
  onUnlock,
  onToggleActive,
}: {
  member: StaffRowData;
  /** The signed-in Admin's own row. */
  isSelf: boolean;
  busy: boolean;
  onEdit: () => void;
  onSetPassword: () => void;
  onUnlock: () => void;
  onToggleActive: () => void;
}) {
  const deactivated = member.status === "deactivated";
  const canUnlock = member.status === "locked" || (member.failedAttempts > 0 && !deactivated);
  return (
    // Not modal: an item opens a sheet or dialog, which manages focus itself.
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          id={menuButtonId(member.id)}
          type="button"
          aria-label={`Actions for ${member.name}`}
          className="inline-flex size-11 cursor-pointer items-center justify-center rounded text-foreground transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted"
        >
          <MoreHorizontal className="size-5" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-56 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          <DropdownMenu.Item className={MENU_ITEM} onSelect={onEdit}>
            <Pencil aria-hidden="true" /> Edit
          </DropdownMenu.Item>
          <DropdownMenu.Item className={MENU_ITEM} onSelect={onSetPassword}>
            <KeyRound aria-hidden="true" /> Set temporary password
          </DropdownMenu.Item>
          {canUnlock && (
            <DropdownMenu.Item className={MENU_ITEM} disabled={busy} onSelect={onUnlock}>
              <LockOpen aria-hidden="true" /> Unlock
            </DropdownMenu.Item>
          )}
          {/* An Admin can't deactivate themself (the server refuses too). */}
          {!isSelf && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                className={cn(MENU_ITEM, !deactivated && "text-destructive")}
                onSelect={onToggleActive}
              >
                {deactivated ? <Power aria-hidden="true" /> : <PowerOff aria-hidden="true" />}
                {deactivated ? "Reactivate" : "Deactivate"}
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ConfirmActiveDialog({
  confirming,
  open,
  onClose,
  onDone,
}: {
  confirming: Confirming;
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  // The dialog mounts fresh on every open (keyed by the caller), so no old error lingers.
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { member, kind } = confirming;
  const deactivate = kind === "deactivate";

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      let result: ActionResult<StaffActionData>;
      try {
        result = await (deactivate ? deactivateStaffAction : reactivateStaffAction)({ id: member.id });
      } catch {
        setError(NETWORK_ERROR);
        return;
      }
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (!result.data.changed) {
        // Someone else got there first: close and say so on the page.
        onDone(`${member.name} was already ${deactivate ? "deactivated" : "active"}.`);
        return;
      }
      onDone(`${member.name} ${deactivate ? "deactivated" : "reactivated"}.`);
    });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <AlertDialogContent onCloseAutoFocus={(event) => returnFocus(event, menuButtonId(member.id))}>
        <AlertDialogHeader>
          <AlertDialogTitle>{deactivate ? `Deactivate ${member.name}?` : `Reactivate ${member.name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {deactivate
              ? `${member.name} is signed out at once and can't sign in. Their past actions stay under their name.`
              : `${member.name} can sign in again with their current password. A lockout from before is cleared.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div role="alert" aria-live="assertive" aria-atomic="true">
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
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
            {deactivate ? `Deactivate ${member.name}` : `Reactivate ${member.name}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
