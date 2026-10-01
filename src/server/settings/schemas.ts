import "server-only";
import { z } from "zod";
import {
  HOSPITAL_NAME_MAX,
  HOSPITAL_NAME_MESSAGE,
  HOSPITAL_NAME_MIN,
  LEGALLY_REQUIRED,
  LEVEL_NAME_MAX,
  LEVEL_NAME_MIN,
  LEVEL_RANK_MAX,
  LEVELS_MAX,
  THRESHOLD_LIMITS,
} from "@/lib/clinical-settings";

/** Facility names: 2–60 characters after trimming. */
export const FACILITY_NAME_MIN = 2;
export const FACILITY_NAME_MAX = 60;
/** Queue Number prefixes: 2–3 uppercase letters. */
export const PREFIX_PATTERN = /^[A-Z]{2,3}$/;
/** 24-hour `HH:MM`. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const PREFIX_TAKEN = "Prefix already in use";
export const NAME_TAKEN = "Name already in use";

const facilityId = z.string().trim().min(1, "Choose a Facility.").max(64);

export const facilityIdSchema = z.object({ id: facilityId });

/** The Facility edit form. `prefix` is what the Admin wants from the next OPD day. */
export const updateFacilitySchema = z
  .object({
    id: facilityId,
    name: z
      .string("Enter a name.")
      .trim()
      .min(FACILITY_NAME_MIN, `Name must be ${FACILITY_NAME_MIN}–${FACILITY_NAME_MAX} characters.`)
      .max(FACILITY_NAME_MAX, `Name must be ${FACILITY_NAME_MIN}–${FACILITY_NAME_MAX} characters.`),
    prefix: z
      .string("Enter a prefix.")
      .trim()
      .toUpperCase()
      .regex(PREFIX_PATTERN, "Prefix must be 2–3 letters, A–Z."),
    openDays: z
      .array(z.coerce.number().int().min(1).max(7), "Choose at least one open day.")
      .min(1, "Choose at least one open day.")
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    openTime: z.string("Enter an opening time.").regex(TIME_PATTERN, "Enter the opening time as HH:MM."),
    closeTime: z.string("Enter a closing time.").regex(TIME_PATTERN, "Enter the closing time as HH:MM."),
    isLive: z.boolean(),
  })
  // Only compared when both times are valid; otherwise their own errors show.
  .refine(
    (value) =>
      !TIME_PATTERN.test(value.openTime) || !TIME_PATTERN.test(value.closeTime) || value.closeTime > value.openTime,
    {
    path: ["closeTime"],
      message: "Closing time must be later than opening time.",
    },
  );

export type UpdateFacilityInput = z.infer<typeof updateFacilitySchema>;

/* ---------- Clinical settings (FR-24) ---------- */

export { LEGALLY_REQUIRED, LEVEL_NAME_MAX, LEVEL_NAME_MIN, LEVEL_RANK_MAX, LEVELS_MAX, THRESHOLD_LIMITS };

export const NO_NON_ER_LEVEL = "Keep at least one level that isn't ER.";
export const RANK_TAKEN = "Rank already used";
export const LEVEL_NAME_TAKEN = "Name already used";

export const SCHEDULE_DAY_MAX = 90;
export const SCHEDULE_DOSES_MIN = 2;
export const SCHEDULE_DOSES_MAX = 10;
export const SCHEDULE_ORDER = "Start at Day 0, then later days in order.";
export const SCHEDULE_FORMAT = `Enter whole days from 0 to ${SCHEDULE_DAY_MAX}, separated by commas.`;
export const SCHEDULE_COUNT = `Enter ${SCHEDULE_DOSES_MIN} to ${SCHEDULE_DOSES_MAX} dose days.`;

/**
 * A whole number from a form. null and blank strings are missing; a string
 * counts only when it is plain digits ("0x10", "1e1", "+5" are rejected).
 */
function wholeNumber(min: number, max: number, message: string) {
  return z.preprocess(
    (value) => {
      if (value === null) return undefined;
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      if (trimmed === "") return undefined;
      return /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    },
    z.number(message).int(message).min(min, message).max(max, message),
  );
}

const settingsId = z.string().trim().min(1, "Missing id.").max(64);

const RANK_MESSAGE = `Enter a rank from 1 to ${LEVEL_RANK_MAX}.`;
const LEVEL_NAME_MESSAGE = `Name must be ${LEVEL_NAME_MIN}–${LEVEL_NAME_MAX} characters.`;

/** A validated Urgency Levels row. `id` is absent for a level added in this save. */
export type UrgencyLevelInput = { id?: string; name: string; isEr: boolean; rank: number | null };

/** One row of the Urgency Levels form. ER levels have no rank; whatever was typed is dropped. */
const urgencyLevelInput = z
  .object({
    id: settingsId.optional(),
    name: z.string("Enter a name.").trim().min(LEVEL_NAME_MIN, LEVEL_NAME_MESSAGE).max(LEVEL_NAME_MAX, LEVEL_NAME_MESSAGE),
    isEr: z.boolean(),
    rank: z.unknown().optional(),
  })
  .transform((value, ctx): UrgencyLevelInput => {
    if (value.isEr) return { id: value.id, name: value.name, isEr: true, rank: null };
    const rank = wholeNumber(1, LEVEL_RANK_MAX, RANK_MESSAGE).safeParse(value.rank);
    if (!rank.success) {
      ctx.addIssue({ code: "custom", path: ["rank"], message: RANK_MESSAGE });
      return z.NEVER;
    }
    return { id: value.id, name: value.name, isEr: false, rank: rank.data as number | null };
  });

/** The whole Urgency Levels list. Levels left out are removed (soft). */
export const updateUrgencyLevelsSchema = z
  .object({
    levels: z.array(urgencyLevelInput, "Add at least one level.").max(LEVELS_MAX, `Keep ${LEVELS_MAX} levels or fewer.`),
  })
  .superRefine((value, ctx) => {
    const ids = value.levels.map((level) => level.id).filter((id): id is string => id !== undefined);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: [], message: "A level appears twice. Reload the page and try again." });
    }
  });

export type UpdateUrgencyLevelsInput = z.output<typeof updateUrgencyLevelsSchema>;

/** Turn a Priority Category on or off. Turning off a legally required one needs `confirmLegal`. */
export const setPriorityCategoryEnabledSchema = z.object({
  id: settingsId,
  enabled: z.boolean(),
  confirmLegal: z.boolean().optional(),
});

export type SetPriorityCategoryEnabledInput = z.output<typeof setPriorityCategoryEnabledSchema>;

/** Dose days: "0, 3, 7" or [0, 3, 7]. Day 0 first, strictly increasing, 0–90, 2–10 doses. */
const scheduleDays = z
  .union([z.string(), z.array(z.unknown())], "Enter the dose days.")
  .transform((value, ctx) => {
    const parts =
      typeof value === "string"
        ? value
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part !== "")
        : value;
    const days: number[] = [];
    for (const part of parts) {
      const day = typeof part === "number" ? part : typeof part === "string" && /^\d+$/.test(part) ? Number(part) : NaN;
      if (!Number.isInteger(day) || day < 0 || day > SCHEDULE_DAY_MAX) {
        ctx.addIssue({ code: "custom", message: SCHEDULE_FORMAT });
        return z.NEVER;
      }
      days.push(day);
    }
    if (days.length < SCHEDULE_DOSES_MIN || days.length > SCHEDULE_DOSES_MAX) {
      ctx.addIssue({ code: "custom", message: SCHEDULE_COUNT });
      return z.NEVER;
    }
    if (days[0] !== 0 || days.some((day, i) => i > 0 && day <= days[i - 1])) {
      ctx.addIssue({ code: "custom", message: SCHEDULE_ORDER });
      return z.NEVER;
    }
    return days;
  });

export const updateClinicalScheduleSchema = z.object({ id: settingsId, days: scheduleDays });

export type UpdateClinicalScheduleInput = z.output<typeof updateClinicalScheduleSchema>;

const { prenatalTarget, noShowThreshold, preCloseWarningMinutes } = THRESHOLD_LIMITS;

export const updateOpdThresholdsSchema = z.object({
  prenatalTarget: wholeNumber(
    prenatalTarget.min,
    prenatalTarget.max,
    `Enter a whole number from ${prenatalTarget.min} to ${prenatalTarget.max}.`,
  ),
  noShowThreshold: wholeNumber(
    noShowThreshold.min,
    noShowThreshold.max,
    `Enter a whole number from ${noShowThreshold.min} to ${noShowThreshold.max}.`,
  ),
  preCloseWarningMinutes: wholeNumber(
    preCloseWarningMinutes.min,
    preCloseWarningMinutes.max,
    `Enter a whole number of minutes from ${preCloseWarningMinutes.min} to ${preCloseWarningMinutes.max}.`,
  ),
  /** Printed on queue slips. Left out, the stored name is kept. Inner runs of spaces collapse to one. */
  hospitalName: z
    .string(HOSPITAL_NAME_MESSAGE)
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(HOSPITAL_NAME_MIN, HOSPITAL_NAME_MESSAGE).max(HOSPITAL_NAME_MAX, HOSPITAL_NAME_MESSAGE))
    .optional(),
});

export type UpdateOpdThresholdsInput = z.output<typeof updateOpdThresholdsSchema>;
