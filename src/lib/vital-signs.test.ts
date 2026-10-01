import { describe, expect, it } from "vitest";
import { triageInputSchema } from "./triage";
import { abnormalFields, checkVital, impossibleMessage, normalRange, VITAL_FIELDS, VITAL_SIGNS } from "./vital-signs";

describe("VITAL_SIGNS", () => {
  it("holds the FR-7 table", () => {
    expect(VITAL_SIGNS.temperatureC).toMatchObject({ impossible: { min: 30, max: 45 }, normal: { min: 36, max: 37.5 }, required: true });
    expect(VITAL_SIGNS.bpSystolic).toMatchObject({ impossible: { min: 50, max: 300 }, normal: { min: 90, max: 139 } });
    expect(VITAL_SIGNS.bpDiastolic).toMatchObject({ impossible: { min: 20, max: 200 }, normal: { min: 60, max: 89 } });
    expect(VITAL_SIGNS.pulse).toMatchObject({ impossible: { min: 20, max: 250 }, normal: { min: 60, max: 100 } });
    expect(VITAL_SIGNS.respiratoryRate).toMatchObject({ impossible: { min: 4, max: 80 }, normal: { min: 12, max: 20 } });
    expect(VITAL_SIGNS.spo2).toMatchObject({ impossible: { min: 50, max: 100 }, normal: { min: 95 }, required: false });
    expect(VITAL_SIGNS.weightKg).toMatchObject({ impossible: { min: 0.3, max: 300 }, normal: null, required: false });
  });

  it("bands pulse and respiratory-rate normals by age", () => {
    expect(normalRange("pulse", 0)).toEqual({ min: 100, max: 160 });
    expect(normalRange("respiratoryRate", 0)).toEqual({ min: 30, max: 60 });
    expect(normalRange("pulse", 1)).toEqual({ min: 70, max: 120 });
    expect(normalRange("respiratoryRate", 12)).toEqual({ min: 18, max: 30 });
    expect(normalRange("pulse", 13)).toEqual({ min: 60, max: 100 });
    expect(normalRange("pulse", null)).toEqual({ min: 60, max: 100 });
    expect(normalRange("temperatureC", 0)).toEqual({ min: 36, max: 37.5 });
  });
});

describe("checkVital", () => {
  it("refuses impossible values with the plain message", () => {
    expect(checkVital("temperatureC", 93.2)).toEqual({ status: "invalid", message: "Temperature must be between 30 and 45 °C." });
    expect(checkVital("temperatureC", "29.9")).toMatchObject({ status: "invalid" });
    expect(checkVital("weightKg", "0.2")).toEqual({ status: "invalid", message: "Weight must be between 0.3 and 300 kg." });
    expect(checkVital("spo2", 101)).toMatchObject({ status: "invalid" });
    for (const field of VITAL_FIELDS) expect(impossibleMessage(field)).toMatch(/must be between/);
  });

  it("flags abnormal values with a hint, and accepts normal ones", () => {
    expect(checkVital("temperatureC", "39.2")).toEqual({ status: "abnormal", value: 39.2, hint: "Above normal (37.5 °C max)" });
    expect(checkVital("temperatureC", 35.5)).toEqual({ status: "abnormal", value: 35.5, hint: "Below normal (36.0 °C min)" });
    expect(checkVital("temperatureC", "37.5")).toEqual({ status: "ok", value: 37.5 });
    expect(checkVital("spo2", 93)).toMatchObject({ status: "abnormal", hint: "Below normal (95 % min)" });
    expect(checkVital("weightKg", 250)).toEqual({ status: "ok", value: 250 });
  });

  it("uses the age band", () => {
    expect(checkVital("pulse", 130, { age: 0 }).status).toBe("ok");
    expect(checkVital("pulse", 130, { age: 30 }).status).toBe("abnormal");
    expect(checkVital("respiratoryRate", 25, { age: 5 }).status).toBe("ok");
  });

  it("requires the required fields only", () => {
    expect(checkVital("temperatureC", "")).toEqual({ status: "invalid", message: "Enter the temperature." });
    expect(checkVital("spo2", "  ")).toEqual({ status: "empty" });
    expect(checkVital("weightKg", undefined)).toEqual({ status: "empty" });
  });

  it("refuses malformed numbers and too many decimals", () => {
    expect(checkVital("pulse", "8o")).toMatchObject({ status: "invalid", message: "Pulse must be a whole number." });
    expect(checkVital("pulse", "80.5")).toMatchObject({ status: "invalid" });
    expect(checkVital("temperatureC", "37.25")).toMatchObject({ status: "invalid" });
    expect(checkVital("temperatureC", "-37")).toMatchObject({ status: "invalid" });
  });

  it("refuses a diastolic at or above the systolic", () => {
    expect(checkVital("bpDiastolic", 130, { systolic: 120 })).toEqual({
      status: "invalid",
      message: "Diastolic BP must be lower than systolic.",
    });
    expect(checkVital("bpDiastolic", 120, { systolic: 120 }).status).toBe("invalid");
    expect(checkVital("bpDiastolic", 80, { systolic: 120 }).status).toBe("ok");
  });
});

describe("abnormalFields", () => {
  it("lists the flagged fields in table order", () => {
    expect(
      abnormalFields({ temperatureC: 39.2, bpSystolic: 150, bpDiastolic: 80, pulse: 80, respiratoryRate: 16, spo2: null }, 40),
    ).toEqual(["temperatureC", "bpSystolic"]);
  });
});

describe("triageInputSchema", () => {
  const base = {
    patientId: "p-1",
    chiefComplaint: "  Cough for 3 days ",
    temperatureC: "37.2",
    bpSystolic: "120",
    bpDiastolic: "80",
    pulse: "80",
    respiratoryRate: "16",
    spo2: "",
    weightKg: "",
    urgencyLevelId: "lvl",
  };

  it("parses typed text into numbers and trims the complaint", () => {
    expect(triageInputSchema.parse(base)).toMatchObject({
      chiefComplaint: "Cough for 3 days",
      temperatureC: 37.2,
      bpSystolic: 120,
      spo2: null,
      weightKg: null,
    });
  });

  it("gives field errors for impossible values, missing fields and diastolic ≥ systolic", () => {
    const result = triageInputSchema.safeParse({ ...base, temperatureC: "93.2", chiefComplaint: " ", urgencyLevelId: "" });
    expect(result.success).toBe(false);
    const fields = Object.fromEntries(result.error!.issues.map((i) => [i.path[0], i.message]));
    expect(fields).toMatchObject({
      temperatureC: "Temperature must be between 30 and 45 °C.",
      chiefComplaint: "Enter the chief complaint.",
      urgencyLevelId: "Choose an Urgency Level.",
    });
    const bp = triageInputSchema.safeParse({ ...base, bpSystolic: "120", bpDiastolic: "130" });
    expect(bp.error!.issues).toEqual([expect.objectContaining({ path: ["bpDiastolic"] })]);
  });

  it("limits the complaint to 500 characters", () => {
    expect(triageInputSchema.safeParse({ ...base, chiefComplaint: "x".repeat(500) }).success).toBe(true);
    expect(triageInputSchema.safeParse({ ...base, chiefComplaint: "x".repeat(501) }).success).toBe(false);
  });
});
