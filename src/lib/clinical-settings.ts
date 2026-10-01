/**
 * Clinical settings limits and messages (FR-24), shared by the server
 * validation (`server/settings/schemas.ts`) and the settings page forms.
 */

export const LEVEL_NAME_MIN = 2;
export const LEVEL_NAME_MAX = 30;
export const LEVEL_RANK_MAX = 99;
export const LEVELS_MAX = 20;

export const LEGALLY_REQUIRED = "Legally required (RA 9994 / RA 10754)";

export const THRESHOLD_LIMITS = {
  prenatalTarget: { min: 1, max: 20 },
  noShowThreshold: { min: 1, max: 10 },
  preCloseWarningMinutes: { min: 0, max: 120 },
} as const;

/** The hospital name printed on queue slips (Story 3.6): 2–80 characters after trimming. */
export const HOSPITAL_NAME_MIN = 2;
export const HOSPITAL_NAME_MAX = 80;
export const HOSPITAL_NAME_MESSAGE = `Hospital name must be ${HOSPITAL_NAME_MIN}–${HOSPITAL_NAME_MAX} characters.`;

/** The lowest rank from 1 to LEVEL_RANK_MAX not in `used`, or null when none is free. */
export function lowestFreeRank(used: Iterable<number>): number | null {
  const taken = new Set(used);
  for (let rank = 1; rank <= LEVEL_RANK_MAX; rank++) {
    if (!taken.has(rank)) return rank;
  }
  return null;
}
