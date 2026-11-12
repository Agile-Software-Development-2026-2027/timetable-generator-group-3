import { describe, it, expect } from "vitest";
import { formatDays, slotFormErrors, slotFormFromConfig, slotPayload, slotPreview, toMinutes } from "../slot-config.mjs";

const valid = { working_days: [0, 1, 2, 3, 4], start_time: "09:00", end_time: "18:00", block_minutes: "60" };

describe("slot configuration helpers", () => {
  it("builds a form from the API config", () => {
    const config = { working_days: [4, 0], start_time: "08:30", end_time: "17:00", block_minutes: 90 };
    expect(slotFormFromConfig(config)).toEqual({ working_days: [0, 4], start_time: "08:30", end_time: "17:00", block_minutes: "90" });
  });

  it("converts HH:MM to minutes", () => {
    expect(toMinutes("09:30")).toBe(570);
    expect(toMinutes("25:00")).toBeNull();
    expect(toMinutes("")).toBeNull();
  });

  it("accepts a valid configuration", () => {
    expect(slotFormErrors(valid)).toEqual({});
  });

  it.each([
    [{ working_days: [] }, "working_days", "Select at least one working day."],
    [{ end_time: "09:00" }, "end_time", "End time must be after start time."],
    [{ end_time: "08:00" }, "end_time", "End time must be after start time."],
    [{ block_minutes: "0" }, "block_minutes", "Block length must be a whole number greater than 0."],
    [{ block_minutes: "" }, "block_minutes", "Block length must be a whole number greater than 0."],
    [{ block_minutes: "1.5" }, "block_minutes", "Block length must be a whole number greater than 0."],
    [{ end_time: "09:45" }, "block_minutes", "The time range is shorter than one block."],
    [{ start_time: "" }, "start_time", "Enter a start time."],
  ])("rejects %o", (change, field, message) => {
    expect(slotFormErrors({ ...valid, ...change })[field]).toBe(message);
  });

  it("formats day ranges and lists", () => {
    expect(formatDays([0, 1, 2, 3, 4])).toBe("Mon–Fri");
    expect(formatDays([4, 2, 0])).toBe("Mon, Wed, Fri");
    expect(formatDays([0, 1])).toBe("Mon, Tue");
    expect(formatDays([6])).toBe("Sun");
  });

  it("describes the grid in the live preview", () => {
    expect(slotPreview(valid)).toBe("Mon–Fri · 09:00–18:00 · 60 min blocks → 9 slots/day × 5 days = 45 total slots");
    expect(slotPreview({ ...valid, working_days: [2], block_minutes: "120" })).toBe("Wed · 09:00–18:00 · 120 min blocks → 4 slots/day × 1 day = 4 total slots");
    expect(slotPreview({ ...valid, working_days: [] })).toBeNull();
  });

  it("builds the PUT payload", () => {
    expect(slotPayload({ ...valid, working_days: [3, 1] })).toEqual({
      working_days: [1, 3], start_time: "09:00:00", end_time: "18:00:00", block_minutes: 60,
    });
  });
});
