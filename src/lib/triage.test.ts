import { describe, expect, it } from "vitest";
import { lowestNonErRank, urgencyTone } from "./triage";

const ER = { isEr: true, rank: null };
const levels = (...ranks: number[]) => [...ranks.map((rank) => ({ isEr: false, rank })), ER];

describe("lowestNonErRank", () => {
  it("is the highest non-ER rank number, or null", () => {
    expect(lowestNonErRank(levels(1, 2, 4))).toBe(4);
    expect(lowestNonErRank([ER])).toBeNull();
    expect(lowestNonErRank([])).toBeNull();
  });
});

describe("urgencyTone", () => {
  it("is urgent for an ER level and for rank 1", () => {
    expect(urgencyTone(ER, levels(1, 2))).toBe("urgent");
    expect(urgencyTone({ isEr: false, rank: 1 }, levels(1, 2))).toBe("urgent");
  });

  it("is routine for the lowest non-ER rank", () => {
    expect(urgencyTone({ isEr: false, rank: 2 }, levels(1, 2))).toBe("routine");
    expect(urgencyTone({ isEr: false, rank: 4 }, levels(1, 2, 3, 4))).toBe("routine");
  });

  it("is abnormal for ranks in between, with three or more levels", () => {
    expect(urgencyTone({ isEr: false, rank: 2 }, levels(1, 2, 3))).toBe("abnormal");
    expect(urgencyTone({ isEr: false, rank: 3 }, levels(1, 2, 3, 4))).toBe("abnormal");
  });
});
