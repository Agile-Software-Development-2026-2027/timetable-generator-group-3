import { describe, it, expect, vi } from "vitest";
import {
  getCalendarTimeRange,
  getCalendarWeekSettings,
  getResponsiveCalendarView,
  SESSION_PAGE_SIZE,
  fetchAllSessions,
} from "../sessions.mjs";

const sessions = (count, start = 1) => Array.from({ length: count }, (_, index) => ({ id: start + index }));

describe("getCalendarTimeRange", () => {
  it("uses the default UniCal slot range when there are no sessions", () => {
    expect(getCalendarTimeRange([])).toEqual({ min: "09:00:00", max: "18:00:00" });
  });

  it("keeps the visible range aligned with the configured slot range", () => {
    expect(getCalendarTimeRange([
      { start_time: "09:15:00", end_time: "10:00:00" },
      { start_time: "14:00:00", end_time: "16:30:00" },
    ], { working_days: [0, 1, 2, 3, 4], start_time: "09:00:00", end_time: "18:00:00", block_minutes: 60 })).toEqual({ min: "08:00:00", max: "19:00:00" });
  });

  it("keeps the visible range within the configured day window", () => {
    expect(getCalendarTimeRange([
      { start_time: "00:00:00", end_time: "23:59:00" },
    ], { working_days: [0], start_time: "09:00:00", end_time: "18:00:00", block_minutes: 60 })).toEqual({ min: "00:00:00", max: "24:00:00" });
  });
});

describe("getCalendarWeekSettings", () => {
  it("maps UniCal Monday-first weekdays to FullCalendar and hides the weekend", () => {
    expect(getCalendarWeekSettings([0, 1, 2, 3, 4])).toEqual({
      firstDay: 1,
      hiddenDays: [0, 6],
    });
  });
});

describe("getResponsiveCalendarView", () => {
  it("uses an agenda for the weekly view on narrow screens and restores the grid on wide screens", () => {
    expect(getResponsiveCalendarView("timeGridWeek", true)).toBe("listWeek");
    expect(getResponsiveCalendarView("listWeek", false)).toBe("timeGridWeek");
  });

  it("leaves explicitly selected day and month views unchanged", () => {
    expect(getResponsiveCalendarView("timeGridDay", true)).toBeNull();
    expect(getResponsiveCalendarView("dayGridMonth", false)).toBeNull();
  });
});

describe("fetchAllSessions", () => {
  it("asks for the largest page the API allows", async () => {
    const request = vi.fn(() => Promise.resolve(sessions(3)));

    await fetchAllSessions(request);

    expect(request).toHaveBeenCalledWith(`/timetable/sessions?page=1&page_size=${SESSION_PAGE_SIZE}`);
  });

  it("stops after one request when everything fits on a page", async () => {
    const request = vi.fn(() => Promise.resolve(sessions(3)));

    expect(await fetchAllSessions(request)).toHaveLength(3);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when there are no sessions", async () => {
    const request = vi.fn(() => Promise.resolve([]));

    expect(await fetchAllSessions(request)).toEqual([]);
  });

  it("keeps fetching pages until a short one arrives", async () => {
    const pages = [sessions(SESSION_PAGE_SIZE), sessions(SESSION_PAGE_SIZE, 501), sessions(7, 1001)];
    const request = vi.fn(() => Promise.resolve(pages.shift()));

    const all = await fetchAllSessions(request);

    expect(all).toHaveLength(2 * SESSION_PAGE_SIZE + 7);
    expect(all.at(-1).id).toBe(1007);
    expect(request.mock.calls.map(([path]) => path.match(/[?&]page=(\d+)/)[1])).toEqual(["1", "2", "3"]);
  });

  it("asks for one more page when the last page is exactly full", async () => {
    const pages = [sessions(SESSION_PAGE_SIZE), []];
    const request = vi.fn(() => Promise.resolve(pages.shift()));

    expect(await fetchAllSessions(request)).toHaveLength(SESSION_PAGE_SIZE);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("passes errors on to the caller", async () => {
    const request = vi.fn(() => Promise.reject(new Error("Server unavailable")));

    await expect(fetchAllSessions(request)).rejects.toThrow("Server unavailable");
  });
});
