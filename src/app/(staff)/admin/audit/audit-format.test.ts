import { describe, expect, it } from "vitest";
import { describeChanges, formatValue } from "./audit-format";

describe("formatValue", () => {
  it("shows scalars and empties", () => {
    expect(formatValue("Joy")).toBe("Joy");
    expect(formatValue(3)).toBe("3");
    expect(formatValue(false)).toBe("false");
    expect(formatValue(null)).toBe("—");
    expect(formatValue("")).toBe('""');
    expect(formatValue([])).toBe("none");
  });

  it("lists named things by name, and other lists plainly", () => {
    expect(formatValue([{ id: "f1", name: "Prenatal" }, { id: "f2", name: "Animal Bite Center" }])).toBe(
      "Prenatal, Animal Bite Center",
    );
    expect(formatValue([0, 3, 7])).toBe("0, 3, 7");
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("describeChanges", () => {
  it("shows no changes as none", () => {
    expect(describeChanges(null)).toEqual({ kind: "none" });
    expect(describeChanges({})).toEqual({ kind: "none" });
  });

  it("keeps raw text", () => {
    expect(describeChanges("not json")).toEqual({ kind: "raw", text: "not json" });
  });

  it("shows old → new pairs and single values", () => {
    expect(
      describeChanges({
        username: "joy.santos",
        role: { old: "triage_nurse", new: "facility_staff" },
        prefix: { old: null, new: "PN" },
      }),
    ).toEqual({
      kind: "fields",
      lines: [
        { field: "username", kind: "value", value: "joy.santos" },
        { field: "role", kind: "diff", old: "triage_nurse", new: "facility_staff" },
        { field: "prefix", kind: "diff", old: "—", new: "PN" },
      ],
    });
  });
});
