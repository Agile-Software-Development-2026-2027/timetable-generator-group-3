import { describe, it, expect, vi } from "vitest";
import {
  getCalendarTimeRange,
  getCalendarVisibleRange,
  getCalendarWeekSettings,
  getResponsiveCalendarView,
  SESSION_PAGE_SIZE,
  fetchAllSessions,
  detectSessionConflicts,
} from "../sessions.mjs";

const sessions = (count, start = 1) => Array.from({ length: count }, (_, index) => ({ id: start + index }));

describe("getCalendarVisibleRange", () => {
  it("shows 07:00 to 20:00 for the default slot configuration", () => {
    expect(getCalendarVisibleRange()).toEqual({ min: "07:00:00", max: "20:00:00" });
  });

  it("widens to whole hours when the configured day is longer", () => {
    expect(getCalendarVisibleRange({ start_time: "06:30:00", end_time: "21:15:00" }))
      .toEqual({ min: "06:00:00", max: "22:00:00" });
  });
});

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


describe("detectSessionConflicts (KAN-21)", () => {
  const courses = [
    { id: 11, name: "Algorithms", semester_id: 101 },
    { id: 12, name: "Databases", semester_id: 101 },
    { id: 13, name: "Networks", semester_id: 102 },
  ];

  const first = {
    id: 1,
    course_id: 11,
    course_name: "Algorithms",
    room_id: 1,
    room_code: "A101",
    weekday: 0,
    start_time: "09:00:00",
    end_time: "10:00:00",
    teacher_ids: [10],
  };

  const second = {
    id: 2,
    course_id: 13,
    course_name: "Networks",
    room_id: 2,
    room_code: "B202",
    weekday: 0,
    start_time: "09:30:00",
    end_time: "10:30:00",
    teacher_ids: [20],
  };

  function types(conflicts, id) {
    return (conflicts.get(id) ?? []).map(
      (conflict) => conflict.type
    );
  }

  it("detects room double-booking for both sessions", () => {
    const result = detectSessionConflicts([
      first,
      { ...second, room_id: 1, room_code: "A101" },
    ], courses);

    expect(types(result, 1)).toEqual(["room_overlap"]);
    expect(types(result, 2)).toEqual(["room_overlap"]);
    expect(result.get(1)[0].relatedSessionId).toBe(2);
    expect(result.get(2)[0].relatedSessionId).toBe(1);
    expect(result.get(1)[0].message).toContain("Networks");
  });

  it("detects shared teachers using teacher IDs", () => {
    const result = detectSessionConflicts([
      first,
      { ...second, teacher_ids: [10, 20] },
    ], courses);

    expect(types(result, 1)).toEqual(["teacher_overlap"]);
    expect(types(result, 2)).toEqual(["teacher_overlap"]);
  });

  it("detects overlapping sessions for the same student group", () => {
    const result = detectSessionConflicts([
      first,
      { ...second, course_id: 12 },
    ], courses);

    expect(types(result, 1)).toEqual([
      "student_group_overlap",
    ]);
    expect(types(result, 2)).toEqual([
      "student_group_overlap",
    ]);
  });

  it.each([
    ["10:00:00", 0],
    ["10:10:00", 10],
    ["10:14:00", 14],
  ])("detects insufficient transition at %s", (start, gap) => {
    const result = detectSessionConflicts([
      first,
      {
        ...second,
        course_id: 12,
        start_time: start,
        end_time: "11:00:00",
      },
    ], courses);

    expect(types(result, 1)).toEqual(["room_transition"]);
    expect(types(result, 2)).toEqual(["room_transition"]);
    expect(result.get(1)[0].message).toContain(`${gap} min`);
  });

  it.each(["10:15:00", "10:30:00"])(
    "allows a sufficient transition at %s",
    (start) => {
      const result = detectSessionConflicts([
        first,
        {
          ...second,
          course_id: 12,
          start_time: start,
          end_time: "11:30:00",
        },
      ], courses);

      expect(result.size).toBe(0);
    }
  );

  it("allows consecutive classes in the same room", () => {
    const result = detectSessionConflicts([
      first,
      {
        ...second,
        course_id: 12,
        room_id: 1,
        teacher_ids: [10],
        start_time: "10:00:00",
        end_time: "11:00:00",
      },
    ], courses);

    expect(result.size).toBe(0);
  });

  it("ignores sessions on different weekdays", () => {
    const result = detectSessionConflicts([
      first,
      {
        ...second,
        weekday: 1,
        room_id: 1,
        course_id: 12,
        teacher_ids: [10],
      },
    ], courses);

    expect(result.size).toBe(0);
  });

  it("does not treat unassigned rooms as double-booked", () => {
    const result = detectSessionConflicts([
      { ...first, room_id: null },
      { ...second, room_id: null },
    ], courses);

    expect(result.size).toBe(0);
  });

  it("does not require travel to an unassigned room", () => {
    const result = detectSessionConflicts([
      first,
      {
        ...second,
        course_id: 12,
        room_id: null,
        start_time: "10:00:00",
        end_time: "11:00:00",
      },
    ], courses);

    expect(result.size).toBe(0);
  });

  it("does not confuse different teachers with identical names", () => {
    const result = detectSessionConflicts([
      { ...first, teacher_names: ["John Smith"] },
      { ...second, teacher_names: ["John Smith"] },
    ], courses);

    expect(result.size).toBe(0);
  });

  it("detects multiple conflict types for one session", () => {
    const result = detectSessionConflicts([
      first,
      {
        ...second,
        course_id: 12,
        room_id: 1,
        teacher_ids: [10],
      },
    ], courses);

    const expected = [
      "room_overlap",
      "teacher_overlap",
      "student_group_overlap",
    ];

    expect(types(result, 1)).toEqual(expected);
    expect(types(result, 2)).toEqual(expected);
  });

  it("removes conflicts after a session is rescheduled", () => {
    const conflicting = { ...second, room_id: 1 };

    expect(
      detectSessionConflicts([first, conflicting], courses).size
    ).toBe(2);

    const fixed = {
      ...conflicting,
      start_time: "11:00:00",
      end_time: "12:00:00",
    };

    expect(
      detectSessionConflicts([first, fixed], courses).size
    ).toBe(0);
  });

  it("detects nested overlaps regardless of session order", () => {
    const result = detectSessionConflicts([
      { ...second, room_id: 1, end_time: "09:45:00" },
      first,
    ], courses);

    expect(types(result, 1)).toEqual(["room_overlap"]);
    expect(types(result, 2)).toEqual(["room_overlap"]);
  });

  it("does not flag unrelated consecutive student groups", () => {
    const result = detectSessionConflicts([
      first,
      {
        ...second,
        start_time: "10:00:00",
        end_time: "11:00:00",
      },
    ], courses);

    expect(result.size).toBe(0);
  });

  it("does not mutate the input session list", () => {
    const input = [
      Object.freeze({ ...second }),
      Object.freeze({ ...first }),
    ];

    Object.freeze(input);

    detectSessionConflicts(input, courses);

    expect(input[0].id).toBe(2);
    expect(input[1].id).toBe(1);
  });

  it("returns no conflicts for an empty session list", () => {
    expect(detectSessionConflicts([], courses).size).toBe(0);
  });

  it("returns no conflicts for a single session", () => {
    expect(
      detectSessionConflicts([first], courses).size
    ).toBe(0);
  });
});



it("handles the sub-minute transition boundary", () => {
  const courses = [
    { id: 11, semester_id: 101 },
    { id: 12, semester_id: 101 },
  ];

  const first = {
    id: 1,
    course_id: 11,
    room_id: 1,
    weekday: 0,
    start_time: "09:00:00",
    end_time: "10:00:30",
    teacher_ids: [],
  };

  const second = {
    id: 2,
    course_id: 12,
    room_id: 2,
    weekday: 0,
    start_time: "10:15:00",
    end_time: "11:00:00",
    teacher_ids: [],
  };

  const result = detectSessionConflicts([first, second], courses);

  expect(result.get(1)[0].type).toBe("room_transition");
  expect(result.get(2)[0].type).toBe("room_transition");

  const fixed = {
    ...second,
    start_time: "10:15:30",
  };

  expect(
    detectSessionConflicts([first, fixed], courses).size
  ).toBe(0);
});
