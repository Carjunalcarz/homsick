// Vital Sign ranges (FR-7), in this one file. Safe to import in client code.
//
// ASSUMPTION: these ranges are placeholders for the nursing lead to confirm
// (PRD FR-7 open question). Change them here only; the form, the server
// validation and the abnormal flags all read this table.
//
// - A value outside the impossible limits is refused (nothing saves).
// - A value outside the normal range is flagged (amber) but saves.

export const VITAL_FIELDS = [
  "temperatureC",
  "bpSystolic",
  "bpDiastolic",
  "pulse",
  "respiratoryRate",
  "spo2",
  "weightKg",
] as const;

export type VitalField = (typeof VITAL_FIELDS)[number];

type Range = { min: number; max: number };
type NormalRange = { min?: number; max?: number };

export type VitalSpec = {
  /** As used in messages: "Temperature must be between …". */
  label: string;
  unit: string;
  required: boolean;
  /** Decimal places allowed (0: whole numbers). */
  decimals: number;
  impossible: Range;
  /** Adult normal range; null: never flagged. */
  normal: NormalRange | null;
};

export const VITAL_SIGNS: Record<VitalField, VitalSpec> = {
  temperatureC: {
    label: "Temperature",
    unit: "°C",
    required: true,
    decimals: 1,
    impossible: { min: 30, max: 45 },
    normal: { min: 36.0, max: 37.5 },
  },
  bpSystolic: {
    label: "Systolic BP",
    unit: "mmHg",
    required: true,
    decimals: 0,
    impossible: { min: 50, max: 300 },
    normal: { min: 90, max: 139 },
  },
  bpDiastolic: {
    label: "Diastolic BP",
    unit: "mmHg",
    required: true,
    decimals: 0,
    impossible: { min: 20, max: 200 },
    normal: { min: 60, max: 89 },
  },
  pulse: {
    label: "Pulse",
    unit: "bpm",
    required: true,
    decimals: 0,
    impossible: { min: 20, max: 250 },
    normal: { min: 60, max: 100 },
  },
  respiratoryRate: {
    label: "Respiratory rate",
    unit: "/min",
    required: true,
    decimals: 0,
    impossible: { min: 4, max: 80 },
    normal: { min: 12, max: 20 },
  },
  spo2: {
    label: "SpO₂",
    unit: "%",
    required: false,
    decimals: 0,
    impossible: { min: 50, max: 100 },
    normal: { min: 95 },
  },
  weightKg: {
    label: "Weight",
    unit: "kg",
    required: false,
    decimals: 1,
    impossible: { min: 0.3, max: 300 },
    normal: null,
  },
};

/** Age-banded normals for pulse and respiratory rate (whole years; null age: adult). */
const CHILD_NORMALS: { maxAge: number; pulse: Range; respiratoryRate: Range }[] = [
  { maxAge: 0, pulse: { min: 100, max: 160 }, respiratoryRate: { min: 30, max: 60 } },
  { maxAge: 12, pulse: { min: 70, max: 120 }, respiratoryRate: { min: 18, max: 30 } },
];

/** The normal range for `field` at `age` (whole years), or null when it's never flagged. */
export function normalRange(field: VitalField, age: number | null): NormalRange | null {
  if ((field === "pulse" || field === "respiratoryRate") && age !== null) {
    const band = CHILD_NORMALS.find((b) => age <= b.maxAge);
    if (band) return band[field];
  }
  return VITAL_SIGNS[field].normal;
}

const REQUIRED_MESSAGES: Record<VitalField, string> = {
  temperatureC: "Enter the temperature.",
  bpSystolic: "Enter the systolic BP.",
  bpDiastolic: "Enter the diastolic BP.",
  pulse: "Enter the pulse.",
  respiratoryRate: "Enter the respiratory rate.",
  spo2: "Enter SpO₂ as a number.",
  weightKg: "Enter the weight as a number.",
};

export const DIASTOLIC_MESSAGE = "Diastolic BP must be lower than systolic.";

/** "Enter the temperature." */
export function requiredMessage(field: VitalField): string {
  return REQUIRED_MESSAGES[field];
}

/** "Temperature must be between 30 and 45 °C." */
export function impossibleMessage(field: VitalField): string {
  const { label, unit, impossible } = VITAL_SIGNS[field];
  return `${label} must be between ${impossible.min} and ${impossible.max} ${unit}.`;
}

export function numberMessage(field: VitalField): string {
  const { label, decimals } = VITAL_SIGNS[field];
  return decimals === 0
    ? `${label} must be a whole number.`
    : `${label} must be a number with at most ${decimals} decimal place${decimals === 1 ? "" : "s"}.`;
}

function formatLimit(field: VitalField, value: number): string {
  const { decimals, unit } = VITAL_SIGNS[field];
  return `${value.toFixed(decimals)} ${unit}`;
}

export type VitalCheck =
  | { status: "empty" }
  | { status: "ok"; value: number }
  | { status: "abnormal"; value: number; hint: string }
  | { status: "invalid"; message: string };

/** Parse typed text as a number: digits with an optional decimal point, else NaN. */
export function parseVital(text: string): number {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

function decimalsOf(value: number): number {
  const text = String(value);
  const dot = text.indexOf(".");
  return dot < 0 || text.includes("e") ? 0 : text.length - dot - 1;
}

/**
 * Check one Vital Sign value (a number, or the form's text): impossible or
 * malformed values are `invalid`; outside the normal range for the age is
 * `abnormal` with a hint such as "Above normal (37.5 °C max)". `systolic`
 * lets the diastolic check that it is lower.
 */
export function checkVital(
  field: VitalField,
  input: number | string | null | undefined,
  context: { age?: number | null; systolic?: number | null } = {},
): VitalCheck {
  if (input === null || input === undefined || (typeof input === "string" && input.trim() === "")) {
    return VITAL_SIGNS[field].required ? { status: "invalid", message: requiredMessage(field) } : { status: "empty" };
  }
  const value = typeof input === "number" ? input : parseVital(input);
  if (!Number.isFinite(value)) return { status: "invalid", message: numberMessage(field) };
  const spec = VITAL_SIGNS[field];
  if (value < spec.impossible.min || value > spec.impossible.max) {
    return { status: "invalid", message: impossibleMessage(field) };
  }
  if (decimalsOf(value) > spec.decimals) return { status: "invalid", message: numberMessage(field) };
  if (field === "bpDiastolic" && typeof context.systolic === "number" && value >= context.systolic) {
    return { status: "invalid", message: DIASTOLIC_MESSAGE };
  }
  const normal = normalRange(field, context.age ?? null);
  if (normal?.max !== undefined && value > normal.max) {
    return { status: "abnormal", value, hint: `Above normal (${formatLimit(field, normal.max)} max)` };
  }
  if (normal?.min !== undefined && value < normal.min) {
    return { status: "abnormal", value, hint: `Below normal (${formatLimit(field, normal.min)} min)` };
  }
  return { status: "ok", value };
}

/** The fields of a set of (valid) vitals that are outside normal for `age`, in table order. */
export function abnormalFields(
  vitals: Partial<Record<VitalField, number | null | undefined>>,
  age: number | null,
): VitalField[] {
  return VITAL_FIELDS.filter((field) => {
    const value = vitals[field];
    if (value === null || value === undefined) return false;
    return checkVital(field, value, { age, systolic: vitals.bpSystolic ?? null }).status === "abnormal";
  });
}
