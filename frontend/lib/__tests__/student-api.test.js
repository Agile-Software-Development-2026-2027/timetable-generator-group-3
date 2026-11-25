import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_PAGE_SIZE } from "../../app/calendar/sessions.mjs";

vi.mock("../api.js", () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from "../api.js";
import {
  fetchStudentCourses,
  fetchAvailableCourses,
  addExtraCourse,
  removeExtraCourse,
  fetchStudentPublicationStatus,
  fetchStudentSessions,
  fetchStudentTimetableData,
} from "../student-api.js";

const assigned = { id: 1, name: "Databases", is_extra: false };
const extra = { id: 2, name: "Statistics", is_extra: true };
const available = { id: 3, name: "Computer Networks" };

const sessionPath = (page) =>
  `/students/me/timetable?page=${page}&page_size=${SESSION_PAGE_SIZE}`;

const fullPage = () =>
  Array.from({ length: SESSION_PAGE_SIZE }, (_, index) => ({
    id: index + 1,
    course_id: 1,
  }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Student API client", () => {
  it("retrieves personal courses through the shared API client", async () => {
    apiRequest.mockResolvedValue([assigned, extra]);

    expect(await fetchStudentCourses()).toEqual([assigned, extra]);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith(
      "/students/me/courses"
    );
  });

  it("retrieves available courses", async () => {
    const request = vi.fn().mockResolvedValue([available]);

    expect(await fetchAvailableCourses(request)).toEqual([available]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "/students/me/available-courses"
    );
  });

  it("adds an extra course without supplying a student ID", async () => {
    const result = {
      course_id: 3,
      enrolled_at: "2026-01-01T10:30:00Z",
    };
    const request = vi.fn().mockResolvedValue(result);

    expect(await addExtraCourse(3, request)).toEqual(result);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "/students/me/enrollments",
      { method: "POST", body: JSON.stringify({ course_id: 3 }) }
    );
  });

  it("removes an extra course", async () => {
    const request = vi.fn().mockResolvedValue(null);

    expect(await removeExtraCourse(2, request)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "/students/me/enrollments/2",
      { method: "DELETE" }
    );
  });

  it.each([0, -1, "5", true, 2.5, null, undefined, NaN, Infinity])(
    "rejects invalid course ID %s without making requests",
    async (courseId) => {
      const request = vi.fn();

      await expect(addExtraCourse(courseId, request))
        .rejects.toThrow("Course ID must be a positive integer.");

      await expect(removeExtraCourse(courseId, request))
        .rejects.toThrow("Course ID must be a positive integer.");

      expect(request).not.toHaveBeenCalled();
    }
  );

  it("retrieves publication status", async () => {
    const publication = { published: true };
    const request = vi.fn().mockResolvedValue(publication);

    expect(await fetchStudentPublicationStatus(request)).toEqual(publication);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "/students/me/timetable-status"
    );
  });

  it("requests only the current student's published sessions", async () => {
    const rows = [{ id: 1, course_id: 1 }];
    const request = vi.fn().mockResolvedValue(rows);

    expect(await fetchStudentSessions(request)).toEqual(rows);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(sessionPath(1));
  });

  it("never falls back to the general timetable endpoint", async () => {
    const error = Object.assign(new Error("Forbidden"), { status: 403 });
    const request = vi.fn().mockRejectedValue(error);

    await expect(fetchStudentSessions(request)).rejects.toBe(error);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      `/students/me/timetable?page=1&page_size=${SESSION_PAGE_SIZE}`
    );
  });

  it("returns an empty list when no sessions exist", async () => {
    const request = vi.fn().mockResolvedValue([]);

    expect(await fetchStudentSessions(request)).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("retrieves every page until a short page arrives", async () => {
    const first = fullPage();
    const second = [{ id: SESSION_PAGE_SIZE + 1, course_id: 2 }];
    const request = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    expect(await fetchStudentSessions(request)).toEqual([...first, ...second]);
    expect(request).toHaveBeenNthCalledWith(1, sessionPath(1));
    expect(request).toHaveBeenNthCalledWith(2, sessionPath(2));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("requests another page when the first page is exactly full", async () => {
    const first = fullPage();
    const request = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([]);

    expect(await fetchStudentSessions(request)).toEqual(first);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(2, sessionPath(2));
  });

  it.each([null, {}, "invalid"])(
    "rejects malformed timetable response %s",
    async (response) => {
      const request = vi.fn().mockResolvedValue(response);

      await expect(fetchStudentSessions(request))
        .rejects.toThrow("Invalid student timetable response.");

      expect(request).toHaveBeenCalledTimes(1);
    }
  );

  it("propagates a failed later page without returning partial results", async () => {
    const error = new Error("Timetable request failed");
    const request = vi.fn()
      .mockResolvedValueOnce(fullPage())
      .mockRejectedValueOnce(error);

    await expect(fetchStudentSessions(request)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("propagates duplicate enrollment errors", async () => {
    const error = Object.assign(new Error("Already enrolled"), { status: 409 });
    const request = vi.fn().mockRejectedValue(error);

    await expect(addExtraCourse(3, request)).rejects.toBe(error);
  });

  it("propagates unauthorized access errors", async () => {
    const error = Object.assign(new Error("Not authenticated"), { status: 401 });
    const request = vi.fn().mockRejectedValue(error);

    await expect(fetchStudentCourses(request)).rejects.toBe(error);
  });

  it("propagates forbidden enrollment removal errors", async () => {
    const error = Object.assign(new Error("Forbidden"), { status: 403 });
    const request = vi.fn().mockRejectedValue(error);

    await expect(removeExtraCourse(2, request)).rejects.toBe(error);
  });

  it("retrieves all data required by the student timetable page", async () => {
    const data = {
      courses: [assigned, extra],
      availableCourses: [available],
      sessions: [{ id: 1, course_id: 1 }],
      publication: { published: true },
    };

    const responses = {
      "/students/me/courses": data.courses,
      "/students/me/available-courses": data.availableCourses,
      [sessionPath(1)]: data.sessions,
      "/students/me/timetable-status": data.publication,
    };
    const request = vi.fn(async (path) => responses[path]);

    expect(await fetchStudentTimetableData(request)).toEqual(data);
    expect(request).toHaveBeenCalledTimes(4);
    Object.keys(responses).forEach((path) => {
      expect(request).toHaveBeenCalledWith(path);
    });
  });

  it("rejects combined data retrieval when a request fails", async () => {
    const error = new Error("Course catalogue unavailable");
    const request = vi.fn(async (path) => {
      if (path === "/students/me/available-courses") throw error;
      return [];
    });

    await expect(fetchStudentTimetableData(request)).rejects.toBe(error);
  });
});
