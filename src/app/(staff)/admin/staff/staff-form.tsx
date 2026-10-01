"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ACTION_BUTTON } from "@/components/page-title";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ActionResult } from "@/lib/action-result";
import { roleLabel } from "@/lib/auth-messages";
import { returnFocus } from "@/lib/focus";
import { cn } from "@/lib/utils";
import { createStaffAction, updateStaffAction, type StaffActionData } from "@/server/auth/staff-actions";
import { FIELD, FieldError, FormError, NETWORK_ERROR } from "@/components/form-parts";
import { PasswordField } from "./form-parts";
import {
  ROLE_ORDER,
  type FacilityOption,
  type PasswordLimits,
  type StaffRole,
  type StaffRowData,
} from "./staff-types";

/** Form fields in visual order: the first one with an error gets focus. */
const FIELD_ORDER = ["name", "username", "role", "facilityIds", "password"] as const;
type FieldName = (typeof FIELD_ORDER)[number];
type FieldErrors = Partial<Record<FieldName, string>>;

const ROLE_HELP: Record<StaffRole, string> = {
  triage_nurse: "Records triage and issues Queue Numbers.",
  facility_staff: "Works the queues of their assigned Facilities.",
  admin: "Manages staff, OPD settings and the audit log.",
};

type Editing = { mode: "create" } | { mode: "edit"; member: StaffRowData };

type Props = {
  editing: Editing | null;
  /** The signed-in Admin: they can't change their own Role. */
  currentUserId: string;
  open: boolean;
  facilities: FacilityOption[];
  passwordLimits: PasswordLimits;
  /** The control to focus again when the sheet closes. */
  returnFocusId: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
};

/** The Create / Edit staff sheet. Its content mounts fresh each time it opens. */
export function StaffForm({
  editing,
  currentUserId,
  open,
  facilities,
  passwordLimits,
  returnFocusId,
  onClose,
  onSaved,
}: Props) {
  // While a save is in flight the sheet can't be dismissed (Esc, overlay):
  // its result must land on a mounted form.
  const [saving, setSaving] = useState(false);
  return (
    <Sheet
      open={open && editing !== null}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 sm:max-w-md"
        onCloseAutoFocus={(event) => returnFocus(event, returnFocusId)}
      >
        {editing && (
          <FormBody
            key={editing.mode === "edit" ? editing.member.id : "new"}
            editing={editing}
            isSelf={editing.mode === "edit" && editing.member.id === currentUserId}
            facilities={facilities}
            passwordLimits={passwordLimits}
            onSaved={onSaved}
            onPendingChange={setSaving}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function FormBody({
  editing,
  isSelf,
  facilities,
  passwordLimits,
  onSaved,
  onPendingChange,
}: {
  editing: Editing;
  isSelf: boolean;
  facilities: FacilityOption[];
  passwordLimits: PasswordLimits;
  onSaved: Props["onSaved"];
  onPendingChange: (pending: boolean) => void;
}) {
  const member = editing.mode === "edit" ? editing.member : null;
  const [name, setName] = useState(member?.name ?? "");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<StaffRole | "">(member?.role ?? "");
  const [facilityIds, setFacilityIds] = useState<string[]>(member?.facilities.map((f) => f.id) ?? []);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    onPendingChange(pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);

  // Active Facilities, plus deactivated ones this person still has (they can
  // be removed but not newly assigned).
  const assigned = new Set(member?.facilities.map((f) => f.id) ?? []);
  const choices = facilities.filter((f) => f.active || assigned.has(f.id));
  const showFacilities = role === "facility_staff";

  const focusFirstError = (fieldErrors: FieldErrors) => {
    const first = FIELD_ORDER.find((field) => fieldErrors[field]);
    if (!first) return;
    // Tried in order; the first match gets focus. A selector list would pick
    // document order instead, so each alternative is its own entry.
    const selectors: Record<FieldName, string[]> = {
      name: ["#staff-name"],
      username: ["#staff-username"],
      role: ['input[name="role"]:checked', 'input[name="role"]:not(:disabled)'],
      facilityIds: ['input[name="facilityIds"]:not(:disabled)'],
      password: ["#staff-password"],
    };
    // After React has rendered the error text the input points to.
    requestAnimationFrame(() => {
      const form = formRef.current;
      if (!form) return;
      for (const selector of selectors[first]) {
        const target = form.querySelector<HTMLElement>(selector);
        if (target) {
          target.focus();
          return;
        }
      }
    });
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    // Only Facility Staff have Facilities: the hidden checkboxes don't count.
    const sentFacilities = role === "facility_staff" ? facilityIds : [];
    startTransition(async () => {
      let result: ActionResult<StaffActionData>;
      try {
        result = member
          ? await updateStaffAction({ id: member.id, name, role, facilityIds: sentFacilities })
          : await createStaffAction({ name, username, role, facilityIds: sentFacilities, password });
      } catch {
        setFormError(NETWORK_ERROR);
        return;
      }
      if (result.ok) {
        setErrors({});
        const saved = result.data.name;
        onSaved(member ? (result.data.changed ? `${saved} saved.` : `No changes to ${saved}.`) : `${saved} can now sign in.`);
        return;
      }
      const fieldErrors: FieldErrors = {};
      const unshown: string[] = [];
      for (const [key, message] of Object.entries(result.error.fieldErrors ?? {})) {
        if (key === "facilityIds" && role !== "facility_staff") fieldErrors.role ??= message;
        else if ((FIELD_ORDER as readonly string[]).includes(key) && !(member && key === "username")) {
          fieldErrors[key as FieldName] = message;
        } else unshown.push(message);
      }
      setErrors(fieldErrors);
      // Errors on keys the form has no field for (id, form) are shown at the top.
      setFormError(unshown.length > 0 ? unshown.join(" ") : result.error.message);
      focusFirstError(fieldErrors);
    });
  };

  const describedBy = (field: FieldName, help?: string) =>
    [help, errors[field] ? `staff-${field}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex h-full flex-col">
      <SheetHeader className="border-b border-border">
        <SheetTitle>{member ? `Edit ${member.name}` : "New staff account"}</SheetTitle>
        <SheetDescription>
          {member
            ? "Name, Role and Facilities. A Role change applies on their next page load."
            : "One account per person. They sign in with the username and this temporary password."}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        <FormError message={formError} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="staff-name" className="text-sm font-medium">
            Full name
          </label>
          <input
            id="staff-name"
            name="name"
            type="text"
            autoComplete="off"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy("name")}
            className={FIELD}
          />
          <FieldError id="staff-name-error" message={errors.name} />
        </div>

        {member ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Username</span>
            <span className="font-mono text-base">{member.username}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="staff-username" className="text-sm font-medium">
              Username
            </label>
            <input
              id="staff-username"
              name="username"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={30}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={errors.username ? true : undefined}
              aria-describedby={describedBy("username", "staff-username-help")}
              className={cn(FIELD, "font-mono")}
            />
            <p id="staff-username-help" className="text-sm text-muted-foreground">
              The person&apos;s own, e.g. joy.santos. Lowercase letters, digits, &quot;.&quot;, &quot;_&quot; or
              &quot;-&quot;.
            </p>
            <FieldError id="staff-username-error" message={errors.username} />
          </div>
        )}

        <fieldset
          className="flex flex-col gap-2"
          aria-describedby={
            [isSelf ? "staff-role-self" : null, errors.role ? "staff-role-error" : null].filter(Boolean).join(" ") ||
            undefined
          }
        >
          <legend className="mb-1.5 text-sm font-medium">Role</legend>
          {isSelf && (
            <p id="staff-role-self" className="text-sm text-muted-foreground">
              You can&apos;t change your own Role.
            </p>
          )}
          {ROLE_ORDER.map((value) => {
            const checked = role === value;
            // The server refuses self-demotion; don't offer it.
            const locked = isSelf && value !== member?.role;
            return (
              <label
                key={value}
                htmlFor={`staff-role-${value}`}
                className={cn(
                  "flex min-h-11 items-start gap-3 rounded border px-3 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  checked ? "border-primary bg-primary/10" : "border-input bg-card",
                  locked ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                  !checked && !locked && "hover:bg-muted",
                  errors.role && "border-destructive",
                )}
              >
                <input
                  id={`staff-role-${value}`}
                  type="radio"
                  name="role"
                  value={value}
                  checked={checked}
                  disabled={locked}
                  onChange={() => setRole(value)}
                  aria-describedby={`staff-role-${value}-help${errors.role ? " staff-role-error" : ""}`}
                  className="mt-0.5 size-4 accent-primary focus-visible:outline-none"
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{roleLabel(value)}</span>
                  <span id={`staff-role-${value}-help`} className="text-xs text-muted-foreground">
                    {ROLE_HELP[value]}
                  </span>
                </span>
              </label>
            );
          })}
          <FieldError id="staff-role-error" message={errors.role} />
        </fieldset>

        {showFacilities && (
          <fieldset
            className="flex flex-col gap-2"
            aria-describedby={["staff-facilityIds-help", errors.facilityIds ? "staff-facilityIds-error" : null]
              .filter(Boolean)
              .join(" ")}
          >
            <legend className="mb-1.5 text-sm font-medium">Facilities</legend>
            <p id="staff-facilityIds-help" className="text-sm text-muted-foreground">
              At least one. They see and work only these Facilities&apos; queues.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {choices.map((facility) => {
                const checked = facilityIds.includes(facility.id);
                return (
                  <label
                    key={facility.id}
                    htmlFor={`staff-facility-${facility.id}`}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-2 rounded border px-3 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                      checked ? "border-primary bg-primary/10" : "border-input bg-card hover:bg-muted",
                      errors.facilityIds && "border-destructive",
                    )}
                  >
                    <input
                      id={`staff-facility-${facility.id}`}
                      type="checkbox"
                      name="facilityIds"
                      value={facility.id}
                      checked={checked}
                      // A deactivated Facility can only be removed.
                      disabled={!facility.active && !checked}
                      onChange={(e) =>
                        setFacilityIds((ids) =>
                          e.target.checked ? [...ids, facility.id] : ids.filter((id) => id !== facility.id),
                        )
                      }
                      aria-invalid={errors.facilityIds ? true : undefined}
                      className="size-4 accent-primary focus-visible:outline-none"
                    />
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold" aria-hidden="true">
                      {facility.prefix}
                    </span>
                    <span>
                      {facility.name}
                      {!facility.active && <span className="text-muted-foreground"> (deactivated)</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            <FieldError id="staff-facilityIds-error" message={errors.facilityIds} />
          </fieldset>
        )}

        {!member && (
          <PasswordField
            id="staff-password"
            value={password}
            onChange={setPassword}
            error={errors.password}
            min={passwordLimits.min}
            max={passwordLimits.max}
          />
        )}
      </div>

      <SheetFooter className="flex-row justify-end border-t border-border">
        <SheetClose asChild>
          <Button type="button" variant="outline" className="h-11 px-4" disabled={pending}>
            Cancel
          </Button>
        </SheetClose>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending || undefined}
          className={cn(
            ACTION_BUTTON,
            "bg-success text-success-foreground hover:bg-success-hover disabled:cursor-not-allowed disabled:opacity-70",
          )}
        >
          {pending ? "Saving…" : member ? "Save" : "Create account"}
        </button>
      </SheetFooter>
    </form>
  );
}
