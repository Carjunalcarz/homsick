import { describe, expect, it } from "vitest";
import { pageItems } from "@/components/data-table/pagination";

describe("pageItems", () => {
  it.each([
    [1, 1, [1]],
    [1, 2, [1, 2]],
    [3, 5, [1, 2, 3, 4, 5]],
    [5, 10, [1, null, 4, 5, 6, null, 10]],
    [10, 10, [1, null, 9, 10]],
  ])("page %i of %i", (page, pageCount, expected) => {
    expect(pageItems(page, pageCount)).toEqual(expected);
  });
});
