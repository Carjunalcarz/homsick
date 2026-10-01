import "server-only";
import { z } from "zod";

/**
 * Input of `recordTriageAction`: the shared rules in `src/lib/triage.ts`,
 * which the form mirrors before it submits.
 */
export { triageInputSchema, type TriageInput } from "@/lib/triage";

/** Input of `getTriageContextAction`. */
export const triageContextSchema = z.object({
  patientId: z.string().trim().min(1).max(64),
});
