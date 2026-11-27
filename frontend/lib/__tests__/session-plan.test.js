import { describe, expect, it } from "vitest";
import { formatHours, splitWeeklyMinutes } from "../session-plan.js";

describe("splitWeeklyMinutes (KAN-78)", () => {
  it.each([
    [5, 180, [180, 120]],
    [4, 180, [120, 120]],
    [11, 180, [180, 180, 180, 120]],
    [6, 180, [180, 180]],
    [2, 180, [120]],
    [5, 120, [120, 120, 60]],
    [4, 60, [60, 60, 60, 60]],
  ])("splits %i h with a %i-minute maximum", (hours, max, expected) => {
    expect(splitWeeklyMinutes(hours * 60, max)).toEqual(expected);
  });

  it("prefers whole hours on a 30-minute grid", () => {
    expect(splitWeeklyMinutes(300, 180, 30)).toEqual([180, 120]);
  });

  it("uses whole grid blocks like the engine", () => {
    // 5 h with a 1.5-hour maximum on a 30-minute grid: 1.5 + 1.5 + 1 + 1.
    expect(splitWeeklyMinutes(300, 90, 30)).toEqual([90, 90, 60, 60]);
  });

  it("returns nothing for invalid input", () => {
    expect(splitWeeklyMinutes(0, 180)).toEqual([]);
    expect(splitWeeklyMinutes(300, 0)).toEqual([]);
  });

  it("formats hours", () => {
    expect(formatHours(180)).toBe("3 h");
    expect(formatHours(90)).toBe("1.5 h");
  });
});
