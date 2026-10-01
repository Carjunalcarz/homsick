"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CircleCheck, FileText, Loader2, Siren, TriangleAlert } from "lucide-react";
import { describedBy, FIELD, FieldError, FormError, NETWORK_ERROR, splitErrors } from "@/components/form-parts";
import { ACTION_BUTTON } from "@/components/page-title";
import { PatientRecordLink } from "@/components/patient-record-link";
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
import { UrgencyBadge } from "@/components/urgency-badge";
import { formatAge } from "@/lib/age";
import { fieldErrorsOf } from "@/lib/field-errors";
import { formatLastVisit } from "@/lib/patient-display";
import { SEX_LABELS } from "@/lib/patient-name";
import { PATIENT_ID_MAX } from "@/lib/patient-registration";
import { formatAhead } from "@/lib/queue-number";
import { OPD_TIME_ZONE } from "@/lib/time";
import {
  COMPLAINT_MAX,
  ID_CATEGORIES,
  isIdCategory,
  isTriageField,
  SENIOR_MIN_AGE,
  TRIAGE_FIELDS,
  TRIAGE_MESSAGES,
  triageInputSchema,
  urgencyTone,
  type TriageField,
} from "@/lib/triage";
import { cn } from "@/lib/utils";
import { checkVital, parseVital, VITAL_FIELDS, VITAL_SIGNS, type VitalField } from "@/lib/vital-signs";
import type { PatientFinderRow } from "@/server/patients/actions";
import {
  getTriageContextAction,
  recordTriageAction,
  type FacilityTile,
  type RecordTriageOutcome,
  type TriageContext,
} from "@/server/triage/actions";
import { PAPER_NUMBER_LABEL } from "@/lib/facility-format";
import { PRINT_SLIP_ID, PrintSlipButton } from "./print-slip";

/*
 * The triage form (Stories 3.4 and 3.5, UX-DR11), in the right column of
 * /triage once a patient is picked. Order (and Tab order): Chief Complaint →
 * Vital Signs → Urgency Level → Priority Category → Facility tiles. Ctrl+Enter
 * or Issue queue number saves and issues the number; with an ER level the
 * tiles are hidden and the button becomes Direct to ER, which asks for
 * confirmation first. The shared Zod rules run first (the action runs them
 * again). Abnormal vitals are flagged amber and still save; impossible ones
 * are red and block the save. Afterwards the cyan banner (number issued)
 * offers Print slip (focused, Story 3.6) and Next patient (Esc); the red ER
 * panel and the paper-number panel offer Next patient (focused, Esc).
 */

export const inputId = (field: TriageField) => `triage-${field}`;
const errorId = (field: TriageField) => `triage-${field}-error`;
export const NEXT_PATIENT_ID = "triage-next-patient";
/** A Priority Category radio ("None" is `inputId("priorityCategory")`). */
const categoryInputId = (code: string) => `triage-category-${code}`;
/** A Facility tile's radio. */
const facilityInputId = (id: string) => `triage-facility-${id}`;
const SAVED_HEADING_ID = "triage-saved-heading";
const SUBMIT_ID = "triage-submit";

const closedTimeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: OPD_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

type Errors = Partial<Record<TriageField, string>>;
type VitalValues = Record<VitalField, string>;

const EMPTY_VITALS: VitalValues = {
  temperatureC: "",
  bpSystolic: "",
  bpDiastolic: "",
  pulse: "",
  respiratoryRate: "",
  spo2: "",
  weightKg: "",
};

type Props = {
  patient: PatientFinderRow;
  /** Focus the Chief Complaint once the form is ready (picked from the finder). */
  autoFocus?: boolean;
  /** Whether anything has been entered (to ask before discarding it). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Next patient (or Esc on the saved panel): clear the screen and go back to the finder. */
  onNextPatient: () => void;
};

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; context: TriageContext };

export function TriageForm({ patient, autoFocus = false, onDirtyChange, onNextPatient }: Props) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [complaint, setComplaint] = useState("");
  const [vitals, setVitals] = useState<VitalValues>(EMPTY_VITALS);
  const [touched, setTouched] = useState<Partial<Record<VitalField, boolean>>>({});
  const [urgencyId, setUrgencyId] = useState("");
  const [category, setCategory] = useState("");
  const [priorityId, setPriorityId] = useState("");
  const [idNotPresented, setIdNotPresented] = useState(false);
  const [facilityId, setFacilityId] = useState("");
  const [confirmingEr, setConfirmingEr] = useState(false);
  const erConfirmed = useRef(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<RecordTriageOutcome | null>(null);
  const [pending, startTransition] = useTransition();
  const focusAfterRender = useRef<string | null>(null);
  const mounted = useRef(true);
  const urgencyRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    getTriageContextAction({ patientId: patient.id })
      .then((result) => {
        if (!live) return;
        if (result.ok) {
          setLoad({ status: "ready", context: result.data });
          if (autoFocus && !result.data.openVisit) focusAfterRender.current = inputId("chiefComplaint");
        } else {
          setLoad({ status: "error", message: result.error.message });
        }
      })
      .catch(() => {
        if (live) setLoad({ status: "error", message: NETWORK_ERROR });
      });
    return () => {
      live = false;
    };
    // Loaded once per patient (the workspace remounts the form for another one) and on Try again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, attempt]);

  useEffect(() => {
    const id = focusAfterRender.current;
    if (!id) return;
    const target = document.getElementById(id);
    // A disabled target (the button while a save is pending) waits for a later render.
    if (!target || (target as HTMLButtonElement).disabled) return;
    focusAfterRender.current = null;
    target.focus();
  });

  /**
   * Reload the Facility tiles (availability and waiting counts change while
   * the form is open). Returns the fresh tiles, or null when the reload failed.
   */
  const refreshFacilities = useCallback(async (): Promise<FacilityTile[] | null> => {
    try {
      const result = await getTriageContextAction({ patientId: patient.id });
      if (!result.ok || !mounted.current) return null;
      const facilities = result.data.facilities;
      setLoad((current) =>
        current.status === "ready" ? { status: "ready", context: { ...current.context, facilities } } : current,
      );
      return facilities;
    } catch {
      return null;
    }
  }, [patient.id]);

  // Fresh tiles when the nurse comes back to this window.
  const formOpen = load.status === "ready" && !saved;
  useEffect(() => {
    if (!formOpen) return;
    const onFocus = () => void refreshFacilities();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [formOpen, refreshFacilities]);

  const dirty =
    !saved &&
    (complaint.trim() !== "" ||
      VITAL_FIELDS.some((field) => vitals[field].trim() !== "") ||
      urgencyId !== "" ||
      category !== "" ||
      priorityId.trim() !== "" ||
      idNotPresented ||
      facilityId !== "");
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Esc on the saved panel: Next patient.
  useEffect(() => {
    if (!saved) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Only from within the triage workspace: Esc in the header search or a menu sheet is theirs.
      const scope = rootRef.current?.closest("[data-triage-workspace]") ?? rootRef.current;
      if (!(event.target instanceof Node) || !scope?.contains(event.target)) return;
      event.preventDefault();
      onNextPatient();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [saved, onNextPatient]);

  const header = <PatientHeader patient={patient} />;

  if (load.status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading the triage form…
        </p>
      </div>
    );
  }

  if (load.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <FormError message={load.message} />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 px-4"
            onClick={() => {
              setLoad({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
          <OpenRecord patientId={patient.id} />
        </div>
      </div>
    );
  }

  const context = load.context;

  if (saved) {
    return (
      <div ref={rootRef} className="flex flex-col gap-4">
        {header}
        {saved.outcome === "queued" ? (
          <IssuedBanner saved={saved} onNextPatient={onNextPatient} />
        ) : saved.outcome === "paper_number" ? (
          <PaperPanel saved={saved} onNextPatient={onNextPatient} />
        ) : (
          <ErPanel saved={saved} onNextPatient={onNextPatient} />
        )}
      </div>
    );
  }

  if (context.openVisit) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p
          role="alert"
          className="flex items-start gap-2 rounded border border-warning/60 bg-warning/10 px-3 py-2 text-sm font-medium"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {context.name} already has an open Visit today.
        </p>
        <div>
          <OpenRecord patientId={patient.id} />
        </div>
      </div>
    );
  }

  const age = context.age;
  const systolic = parseVital(vitals.bpSystolic);
  const levels = context.levels;
  const categories = context.categories.filter((c) => c.code !== "pregnant" || context.sex === "female");
  const idField = isIdCategory(category) ? ID_CATEGORIES[category] : null;
  const idOnFile =
    category === "senior_citizen" ? context.seniorCitizenIdOnFile : category === "pwd" ? context.pwdIdOnFile : false;
  const needsId = idField !== null && !idOnFile;
  const seniorTooYoung = category === "senior_citizen" && (age === null || age < SENIOR_MIN_AGE);
  const isEr = levels.find((l) => l.id === urgencyId)?.isEr ?? false;
  const facilities = context.facilities;
  const firstAvailable = facilities.find((f) => f.available);
  const paperChosen = facilities.some((f) => f.id === facilityId && f.available && f.paper);

  function vitalCheck(field: VitalField) {
    return checkVital(field, vitals[field], { age, systolic: Number.isFinite(systolic) ? systolic : null });
  }

  /** The red error under a field: from the last save, or an impossible value once the field was left. */
  function vitalError(field: VitalField): string | undefined {
    if (errors[field]) return errors[field];
    if (!touched[field] || vitals[field].trim() === "") return undefined;
    const check = vitalCheck(field);
    return check.status === "invalid" ? check.message : undefined;
  }

  function clearError(...fields: TriageField[]) {
    setErrors((current) => {
      if (!fields.some((f) => current[f])) return current;
      const next = { ...current };
      for (const f of fields) delete next[f];
      return next;
    });
  }

  function focusField(field: TriageField) {
    if (field === "urgencyLevelId") {
      const index = Math.max(
        0,
        levels.findIndex((l) => l.id === urgencyId),
      );
      urgencyRefs.current[index]?.focus();
      return;
    }
    document.getElementById(inputId(field))?.focus();
  }

  /** Show the errors and focus the first one; `tiles` is the latest Facility list (after a refetch). */
  function showErrors(fieldErrors: Errors, tiles: FacilityTile[] = facilities) {
    setErrors(fieldErrors);
    const first = TRIAGE_FIELDS.find((field) => fieldErrors[field]);
    if (!first) return;
    if (first === "urgencyLevelId") {
      // The radios are always rendered: focus now.
      requestAnimationFrame(() => focusField(first));
    } else if (first === "priorityCategory") {
      // The refused option, not "None".
      focusAfterRender.current = category ? categoryInputId(category) : inputId("priorityCategory");
    } else if (first === "facilityId") {
      // The chosen tile (if still selectable), else the first selectable one, else the group.
      const chosen = tiles.find((f) => f.id === facilityId && f.available);
      const target = chosen ?? tiles.find((f) => f.available);
      focusAfterRender.current = target ? facilityInputId(target.id) : inputId("facilityId");
    } else {
      focusAfterRender.current = inputId(first);
    }
  }

  function chooseUrgency(index: number) {
    const level = levels[index];
    if (!level) return;
    setUrgencyId(level.id);
    clearError("urgencyLevelId");
    urgencyRefs.current[index]?.focus();
  }

  function onUrgencyKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const current = levels.findIndex((l) => l.id === urgencyId);
    if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (index < levels.length) {
        event.preventDefault();
        chooseUrgency(index);
      }
      return;
    }
    const focused = urgencyRefs.current.findIndex((el) => el === document.activeElement);
    const from = focused >= 0 ? focused : current;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      chooseUrgency(from < 0 ? 0 : (from + 1) % levels.length);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      chooseUrgency(from <= 0 ? levels.length - 1 : from - 1);
    } else if (event.key === " " || event.key === "Enter") {
      if (focused >= 0) {
        event.preventDefault();
        chooseUrgency(focused);
      }
    }
  }

  function buildInput() {
    return {
      patientId: patient.id,
      chiefComplaint: complaint,
      ...vitals,
      urgencyLevelId: urgencyId,
      priorityCategory: category,
      priorityId: needsId ? priorityId : "",
      idNotPresented: needsId ? idNotPresented : false,
      // An ER level never carries a Facility; Direct to ER is set only once confirmed.
      facilityId: isEr ? "" : facilityId,
      directToEr: false,
    };
  }

  /** Ctrl+Enter, Issue queue number or Direct to ER: check the form, then issue, or ask to confirm the ER handoff. */
  function save() {
    if (pending || confirmingEr) return;
    setFormError(null);
    const input = buildInput();
    const fieldErrors: Errors = {};
    const check = triageInputSchema.safeParse(input);
    if (!check.success) {
      for (const [key, message] of Object.entries(fieldErrorsOf(check.error))) {
        if (isTriageField(key)) fieldErrors[key] = message;
      }
    }
    // The diastolic rule needs both values; the schema skips it while other fields fail.
    const diastolic = vitalCheck("bpDiastolic");
    if (!fieldErrors.bpDiastolic && diastolic.status === "invalid" && vitals.bpDiastolic.trim() !== "") {
      fieldErrors.bpDiastolic = diastolic.message;
    }
    if (seniorTooYoung) fieldErrors.priorityCategory = TRIAGE_MESSAGES.seniorAge;
    if (needsId && priorityId.trim() === "" && !idNotPresented) {
      fieldErrors.priorityId = category === "senior_citizen" ? TRIAGE_MESSAGES.seniorId : TRIAGE_MESSAGES.pwdId;
    }
    if (!isEr && !facilities.some((f) => f.id === facilityId && f.available)) {
      fieldErrors.facilityId = TRIAGE_MESSAGES.facility;
    }
    if (Object.keys(fieldErrors).length > 0) {
      setTouched(Object.fromEntries(VITAL_FIELDS.map((f) => [f, true])));
      setFormError("Check the highlighted fields.");
      showErrors(fieldErrors);
      return;
    }
    setErrors({});
    if (isEr) {
      erConfirmed.current = false;
      setConfirmingEr(true);
      return;
    }
    submit(input);
  }

  function submit(input: ReturnType<typeof buildInput>) {
    startTransition(async () => {
      let result;
      try {
        result = await recordTriageAction(input);
      } catch {
        if (!mounted.current) return;
        setFormError(NETWORK_ERROR);
        // After a confirmed Direct to ER the dialog has closed: without this, focus would fall to the page.
        if (input.directToEr) focusAfterRender.current = SUBMIT_ID;
        return;
      }
      if (!mounted.current) return;
      if (result.ok) {
        // Issued: Print slip takes focus, so Enter prints (Story 3.6); paper and ER outcomes print nothing.
        focusAfterRender.current = result.data.outcome === "queued" ? PRINT_SLIP_ID : NEXT_PATIENT_ID;
        setSaved(result.data);
        return;
      }
      const split = splitErrors(result.error, isTriageField);
      // The chosen tile was refused: reload the tiles so it shows why (and can't be picked again).
      const tiles = result.error.code === "facility_unavailable" ? await refreshFacilities() : null;
      if (!mounted.current) return;
      setFormError(split.formError);
      // A refused Direct to ER: the dialog has closed, so focus returns to the button (unless a field takes it below).
      if (input.directToEr) focusAfterRender.current = SUBMIT_ID;
      showErrors(split.fieldErrors as Errors, tiles ?? facilities);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter") return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      save();
      return;
    }
    // Only Ctrl+Enter or the button saves: plain Enter in a field must not submit early (a textarea keeps its newline).
    if (event.target instanceof HTMLInputElement) event.preventDefault();
  }

  const vitalInput = (field: VitalField, label: string, className?: string) => {
    const spec = VITAL_SIGNS[field];
    const error = vitalError(field);
    const check = vitalCheck(field);
    const hint = !error && check.status === "abnormal" ? check.hint : null;
    const hintId = `${inputId(field)}-hint`;
    const unitId = `${inputId(field)}-unit`;
    return (
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        <label htmlFor={inputId(field)} className="text-sm font-medium">
          {label}
          {!spec.required && <span className="font-normal text-muted-foreground"> (optional)</span>}
        </label>
        <div className="relative">
          <input
            id={inputId(field)}
            name={field}
            type="text"
            inputMode={spec.decimals > 0 ? "decimal" : "numeric"}
            autoComplete="off"
            maxLength={6}
            value={vitals[field]}
            onChange={(event) => {
              const value = event.target.value;
              setVitals((current) => ({ ...current, [field]: value }));
              clearError(field, ...(field === "bpSystolic" ? (["bpDiastolic"] as const) : []));
            }}
            onBlur={() => setTouched((current) => (current[field] ? current : { ...current, [field]: true }))}
            aria-invalid={error ? true : undefined}
            aria-describedby={[unitId, hint ? hintId : null, error ? errorId(field) : null].filter(Boolean).join(" ")}
            data-state={error ? "impossible" : hint ? "abnormal" : undefined}
            className={cn(
              FIELD,
              "pr-16 tabular-nums",
              hint && "border-2 border-abnormal focus-visible:border-abnormal",
            )}
          />
          <span
            id={unitId}
            className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground"
          >
            {spec.unit}
          </span>
        </div>
        {hint && (
          <p id={hintId} className="flex items-center gap-1.5 text-sm font-medium text-abnormal">
            <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
            {hint}
          </p>
        )}
        <FieldError id={errorId(field)} message={error} />
      </div>
    );
  };

  const selectedIndex = levels.findIndex((l) => l.id === urgencyId);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const categoryError = errors.priorityCategory ?? (seniorTooYoung ? TRIAGE_MESSAGES.seniorAge : undefined);

  return (
    <form
      noValidate
      aria-label="Record triage"
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="flex flex-col gap-5"
    >
      {header}

      <FormError message={formError} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId("chiefComplaint")} className="text-sm font-medium">
          Chief complaint
        </label>
        <textarea
          id={inputId("chiefComplaint")}
          name="chiefComplaint"
          rows={2}
          maxLength={COMPLAINT_MAX}
          value={complaint}
          onChange={(event) => {
            setComplaint(event.target.value);
            clearError("chiefComplaint");
          }}
          aria-invalid={errors.chiefComplaint ? true : undefined}
          aria-describedby={describedBy(null, errorId("chiefComplaint"), errors.chiefComplaint)}
          className={cn(FIELD, "h-auto min-h-20 py-2")}
        />
        <FieldError id={errorId("chiefComplaint")} message={errors.chiefComplaint} />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-base font-medium">Vital signs</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {vitalInput("temperatureC", "Temperature")}
          <div className="grid grid-cols-2 gap-3" role="group" aria-label="Blood pressure">
            {vitalInput("bpSystolic", "BP systolic")}
            {vitalInput("bpDiastolic", "BP diastolic")}
          </div>
          {vitalInput("pulse", "Pulse")}
          {vitalInput("respiratoryRate", "Respiratory rate")}
          {vitalInput("spo2", "SpO₂")}
          {vitalInput("weightKg", "Weight")}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <span id="triage-urgency-label" className="text-base font-medium">
          Urgency level
        </span>
        <p id="triage-urgency-help" className="text-xs text-muted-foreground">
          Keys 1–{Math.min(levels.length, 9)} pick a level while this group has focus; arrow keys move.
        </p>
        <div
          id={inputId("urgencyLevelId")}
          role="radiogroup"
          aria-labelledby="triage-urgency-label"
          aria-describedby={describedBy("triage-urgency-help", errorId("urgencyLevelId"), errors.urgencyLevelId)}
          aria-invalid={errors.urgencyLevelId ? true : undefined}
          aria-required="true"
          onKeyDown={onUrgencyKeyDown}
          className="flex flex-wrap gap-2"
        >
          {levels.map((level, index) => {
            const checked = level.id === urgencyId;
            const tone = urgencyTone(level, levels);
            return (
              <button
                key={level.id}
                ref={(el) => {
                  urgencyRefs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
                tabIndex={index === tabbableIndex ? 0 : -1}
                onClick={() => chooseUrgency(index)}
                className={cn(
                  "flex h-11 min-w-28 items-center gap-2 rounded border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  checked ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-input bg-card hover:bg-muted",
                  errors.urgencyLevelId && "border-destructive",
                )}
              >
                {index < 9 && (
                  <kbd aria-hidden="true" className="rounded border border-border px-1.5 font-mono text-xs text-muted-foreground">
                    {index + 1}
                  </kbd>
                )}
                <UrgencyBadge name={level.name} tone={tone} isEr={level.isEr} />
              </button>
            );
          })}
        </div>
        <FieldError id={errorId("urgencyLevelId")} message={errors.urgencyLevelId} />
      </div>

      <fieldset
        className="flex flex-col gap-1.5"
        aria-describedby={categoryError ? errorId("priorityCategory") : undefined}
      >
        <legend className="mb-1.5 text-base font-medium">Priority category</legend>
        <div className="flex flex-wrap gap-2">
          {[{ code: "", name: "None" }, ...categories].map((option, index) => (
            <label
              key={option.code || "none"}
              htmlFor={index === 0 ? inputId("priorityCategory") : categoryInputId(option.code)}
              className={cn(
                "flex h-11 min-w-28 cursor-pointer items-center gap-2 rounded border px-3 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                category === option.code ? "border-primary bg-primary/10" : "border-input bg-card hover:bg-muted",
                categoryError && category === option.code && "border-destructive",
              )}
            >
              <input
                id={index === 0 ? inputId("priorityCategory") : categoryInputId(option.code)}
                type="radio"
                name="triage-priority-category"
                value={option.code}
                checked={category === option.code}
                onChange={() => {
                  setCategory(option.code);
                  clearError("priorityCategory", "priorityId");
                }}
                aria-invalid={categoryError && category === option.code ? true : undefined}
                aria-describedby={categoryError ? errorId("priorityCategory") : undefined}
                className="size-4 accent-primary focus-visible:outline-none"
              />
              {option.name}
            </label>
          ))}
        </div>
        <FieldError id={errorId("priorityCategory")} message={categoryError} />
      </fieldset>

      {idField !== null && idOnFile && (
        <p className="flex items-center gap-2 text-sm">
          <CircleCheck className="size-4 text-success" aria-hidden="true" />
          {category === "senior_citizen" ? "Senior Citizen ID on file." : "PWD ID on file."}
        </p>
      )}

      {needsId && (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-medium">
            {category === "senior_citizen" ? "Senior Citizen ID" : "PWD ID"} (none on file)
          </legend>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId("priorityId")} className="text-sm font-medium">
              {category === "senior_citizen" ? "Senior Citizen ID" : "PWD ID"}
            </label>
            <input
              id={inputId("priorityId")}
              type="text"
              autoComplete="off"
              maxLength={PATIENT_ID_MAX}
              value={priorityId}
              disabled={idNotPresented}
              onChange={(event) => {
                setPriorityId(event.target.value);
                clearError("priorityId");
              }}
              aria-invalid={errors.priorityId ? true : undefined}
              aria-describedby={describedBy("triage-priorityId-help", errorId("priorityId"), errors.priorityId)}
              className={FIELD}
            />
            <p id="triage-priorityId-help" className="text-xs text-muted-foreground">
              Saved to the Patient Record.
            </p>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded border border-input px-3 py-2 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <input
              id="triage-idNotPresented"
              type="checkbox"
              checked={idNotPresented}
              onChange={(event) => {
                setIdNotPresented(event.target.checked);
                if (event.target.checked) setPriorityId("");
                clearError("priorityId");
              }}
              className="size-5 shrink-0 accent-primary focus-visible:outline-none"
            />
            ID not presented
          </label>
          <FieldError id={errorId("priorityId")} message={errors.priorityId} />
        </fieldset>
      )}

      {!isEr && (
        <div className="flex flex-col gap-1.5">
          <span id="triage-facility-label" className="text-base font-medium">
            Facility
          </span>
          <div
            id={inputId("facilityId")}
            role="radiogroup"
            tabIndex={-1}
            aria-labelledby="triage-facility-label"
            aria-describedby={errors.facilityId ? errorId("facilityId") : undefined}
            aria-invalid={errors.facilityId ? true : undefined}
            aria-required="true"
            className="grid gap-2 outline-none sm:grid-cols-2"
          >
            {facilities.map((facility) => {
              const checked = facility.available && facility.id === facilityId;
              const detailId = `${facilityInputId(facility.id)}-detail`;
              return (
                <label
                  key={facility.id}
                  htmlFor={facilityInputId(facility.id)}
                  data-available={facility.available}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    !facility.available && "cursor-not-allowed border-dashed border-input bg-muted text-muted-foreground",
                    facility.available && "cursor-pointer",
                    facility.available &&
                      (checked ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-input bg-card hover:bg-muted"),
                    errors.facilityId && facility.available && "border-destructive",
                  )}
                >
                  <input
                    id={facilityInputId(facility.id)}
                    type="radio"
                    name="triage-facility"
                    value={facility.id}
                    checked={checked}
                    disabled={!facility.available}
                    onChange={() => {
                      setFacilityId(facility.id);
                      clearError("facilityId");
                    }}
                    aria-describedby={detailId}
                    className="size-4 shrink-0 accent-primary focus-visible:outline-none"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-foreground">{facility.name}</span>
                    <span id={detailId} className="text-xs text-muted-foreground">
                      {!facility.available
                        ? facility.reason
                        : facility.paper
                          ? PAPER_NUMBER_LABEL
                          : `${facility.waiting} waiting`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {!firstAvailable && (
            <p className="text-sm text-muted-foreground">No Facility is taking patients now.</p>
          )}
          <FieldError id={errorId("facilityId")} message={errors.facilityId} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          id={SUBMIT_ID}
          type="submit"
          disabled={pending}
          aria-busy={pending || undefined}
          aria-keyshortcuts="Control+Enter"
          className={cn(
            ACTION_BUTTON,
            "disabled:cursor-not-allowed disabled:opacity-70",
            isEr
              ? "bg-destructive text-background hover:bg-destructive/90"
              : "bg-success text-success-foreground hover:bg-success-hover",
          )}
        >
          {isEr && <Siren className="size-4" aria-hidden="true" />}
          {pending
            ? isEr
              ? "Directing…"
              : "Saving…"
            : isEr
              ? "Direct to ER"
              : paperChosen
                ? "Record triage (paper number)"
                : "Issue queue number"}
          <kbd aria-hidden="true" className="ml-2 hidden rounded border border-current/40 px-1.5 font-mono text-xs sm:inline">
            Ctrl Enter
          </kbd>
        </button>
        <OpenRecord patientId={patient.id} />
      </div>

      <AlertDialog
        open={confirmingEr}
        onOpenChange={(open) => {
          if (!open) setConfirmingEr(false);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // Confirmed: the ER panel's Next patient takes focus. Cancelled: back to the button.
            if (!erConfirmed.current) document.getElementById(SUBMIT_ID)?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Direct {context.name} to the Emergency Room?</AlertDialogTitle>
            <AlertDialogDescription>No queue number will be issued and the Visit closes.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
            <Button
              type="button"
              className="h-11 bg-destructive text-background hover:bg-destructive/90"
              onClick={() => {
                erConfirmed.current = true;
                setConfirmingEr(false);
                submit({ ...buildInput(), facilityId: "", directToEr: true });
              }}
            >
              Confirm
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function PatientHeader({ patient }: { patient: PatientFinderRow }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <p id="selected-patient-name" className="text-xl font-medium break-words">
          {patient.name}
        </p>
        <span className="rounded bg-muted px-2 py-0.5 font-mono text-sm">{patient.hospitalNumber}</span>
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>{formatAge(patient.age)}</span>
        <span>{SEX_LABELS[patient.sex]}</span>
        <span>Last visit: {formatLastVisit(patient.lastVisit)}</span>
      </p>
    </div>
  );
}

function OpenRecord({ patientId }: { patientId: string }) {
  return (
    <PatientRecordLink
      patientId={patientId}
      aria-describedby="selected-patient-name"
      className="inline-flex h-11 items-center gap-2 rounded border border-input bg-card px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <FileText className="size-4" aria-hidden="true" />
      Open record
    </PatientRecordLink>
  );
}

/** The number issued: a cyan banner with the Queue Number, "{Facility} · N ahead", the level and category. */
type Outcome<K extends RecordTriageOutcome["outcome"]> = Extract<RecordTriageOutcome, { outcome: K }>;

function IssuedBanner({ saved, onNextPatient }: { saved: Outcome<"queued">; onNextPatient: () => void }) {
  const queue = saved.queue;
  return (
    <section
      aria-labelledby={SAVED_HEADING_ID}
      data-testid="queue-issued-banner"
      className="flex flex-col gap-3 rounded-lg bg-banner p-4 text-banner-foreground"
    >
      <h3 id={SAVED_HEADING_ID} className="flex items-center gap-2 text-base font-medium">
        <CircleCheck className="size-5 shrink-0" aria-hidden="true" />
        Queue number issued
      </h3>
      <div role="status" className="flex flex-col gap-2">
        <p className="text-queue-number-issued break-all">{queue.queueNumber}</p>
        <p className="text-base font-medium">
          {queue.facilityName} · {formatAhead(queue.ahead)}
        </p>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <UrgencyBadge name={saved.urgencyName} tone={saved.urgencyTone} isEr={saved.urgencyIsEr} />
        <span className="inline-flex h-6 items-center rounded-full bg-card px-2.5 text-xs font-medium text-card-foreground">
          {saved.priorityCategoryName ?? "No Priority Category"}
        </span>
      </p>
      <div className="flex flex-wrap items-start gap-2">
        {/* Primary and focused when the banner appears: Enter prints (Story 3.6). */}
        <PrintSlipButton
          entryId={queue.entryId}
          className="h-11 bg-white px-4 text-banner hover:bg-white/90 focus-visible:ring-white"
        />
        <div className="flex items-center gap-2">
          <Button
            id={NEXT_PATIENT_ID}
            type="button"
            className="h-11 border-white bg-transparent px-4 text-banner-foreground hover:bg-white/15 focus-visible:ring-white"
            onClick={onNextPatient}
          >
            Next patient
          </Button>
          <span className="text-xs">or press Esc</span>
        </div>
      </div>
    </section>
  );
}

/** Directed to ER: a red-outlined panel, "Directed to ER · Visit closed {h:mm AM}". */
function ErPanel({ saved, onNextPatient }: { saved: Outcome<"directed_to_er">; onNextPatient: () => void }) {
  const closed = closedTimeFormat.format(new Date(saved.closedAt));
  return (
    <section
      aria-labelledby={SAVED_HEADING_ID}
      data-testid="directed-to-er-panel"
      className="flex flex-col gap-3 rounded-lg border-2 border-destructive bg-card p-4"
    >
      <h3 id={SAVED_HEADING_ID} role="status" className="flex items-center gap-2 text-base font-medium text-destructive">
        <Siren className="size-5 shrink-0" aria-hidden="true" />
        Directed to ER · Visit closed {closed}
      </h3>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <UrgencyBadge name={saved.urgencyName} tone={saved.urgencyTone} isEr={saved.urgencyIsEr} />
        <span>{saved.priorityCategoryName ?? "No Priority Category"}</span>
        <span className="text-muted-foreground">· No queue number issued.</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button id={NEXT_PATIENT_ID} type="button" className="h-11 px-4" onClick={onNextPatient}>
          Next patient
        </Button>
        <span className="text-xs text-muted-foreground">or press Esc</span>
      </div>
    </section>
  );
}

/** A not-live Facility (PRD §10 pilot): triage is recorded, the nurse gives a paper number; the Visit stays open. */
function PaperPanel({ saved, onNextPatient }: { saved: Outcome<"paper_number">; onNextPatient: () => void }) {
  return (
    <section
      aria-labelledby={SAVED_HEADING_ID}
      data-testid="paper-number-panel"
      className="flex flex-col gap-3 rounded-lg border-2 border-warning/60 bg-warning/10 p-4"
    >
      <h3 id={SAVED_HEADING_ID} role="status" className="flex items-center gap-2 text-base font-medium">
        <FileText className="size-5 shrink-0" aria-hidden="true" />
        Triage recorded · Give a paper number for {saved.paperFacility.name}
      </h3>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <UrgencyBadge name={saved.urgencyName} tone={saved.urgencyTone} isEr={saved.urgencyIsEr} />
        <span>{saved.priorityCategoryName ?? "No Priority Category"}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button id={NEXT_PATIENT_ID} type="button" className="h-11 px-4" onClick={onNextPatient}>
          Next patient
        </Button>
        <span className="text-xs text-muted-foreground">or press Esc</span>
      </div>
    </section>
  );
}
