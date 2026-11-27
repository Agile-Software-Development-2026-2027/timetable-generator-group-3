import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  API_URL,
  fetchPreflightWarnings,
} from "./api.js";

import { supabase } from "./supabase.js";

vi.mock("./supabase.js", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

const warning = {
  type: "missing_teacher",
  severity: "warning",
  message: "Databases: No teacher is assigned.",
  course_id: 12,
};

function mockResponse(body, status = 200) {
  fetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn());

  supabase.auth.getSession.mockResolvedValue({
    data: {
      session: {
        access_token: "test-access-token",
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KAN-67 preflight API helper", () => {
  it("requests warnings for the selected degree", async () => {
    mockResponse({ warnings: [warning] });

    const result = await fetchPreflightWarnings("7");

    expect(result).toEqual([warning]);

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/timetable/preflight?degree_id=7`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-access-token",
        }),
      })
    );
  });

  it("requests warnings for the selected semester", async () => {
    mockResponse({ warnings: [warning] });

    const controller = new window.AbortController();

    const result = await fetchPreflightWarnings(7, {
      semesterId: "3",
      signal: controller.signal,
    });

    expect(result).toEqual([warning]);

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/timetable/preflight?degree_id=7&semester_id=3`,
      expect.objectContaining({
        signal: controller.signal,
        headers: expect.objectContaining({
          Authorization: "Bearer test-access-token",
        }),
      })
    );

    expect(fetch.mock.calls[0][1]).not.toHaveProperty("semesterId");
  });

  it.each([undefined, null, ""])(
    "preserves degree-wide validation for semester: %s",
    async (semesterId) => {
      mockResponse({ warnings: [] });

      await fetchPreflightWarnings(7, { semesterId });

      expect(fetch).toHaveBeenCalledWith(
        `${API_URL}/timetable/preflight?degree_id=7`,
        expect.any(Object)
      );
    }
  );

  it.each([0, -1, "abc", 1.5, "0"])(
    "rejects invalid semester ID: %s",
    async (semesterId) => {
      await expect(
        fetchPreflightWarnings(7, { semesterId })
      ).rejects.toThrow("Please select a valid semester.");

      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it("propagates semester ownership errors", async () => {
    mockResponse({
      detail: "Semester not found in selected degree.",
    }, 404);

    await expect(
      fetchPreflightWarnings(7, { semesterId: 99 })
    ).rejects.toMatchObject({
      status: 404,
      message: "Semester not found in selected degree.",
    });
  });

  it("returns an empty array for a clean dataset", async () => {
    mockResponse({ warnings: [] });

    await expect(
      fetchPreflightWarnings(7)
    ).resolves.toEqual([]);
  });

  it("preserves error severity and teacher identifiers", async () => {
    const error = {
      type: "teacher_workload",
      severity: "error",
      message: "Teacher workload exceeds configured limits.",
      teacher_id: 5,
    };

    mockResponse({ warnings: [error] });

    await expect(
      fetchPreflightWarnings(7)
    ).resolves.toEqual([error]);
  });

  it.each([
    "",
    0,
    -1,
    "abc",
    1.5,
    null,
    undefined,
  ])("rejects invalid degree ID: %s", async (degreeId) => {
    await expect(
      fetchPreflightWarnings(degreeId)
    ).rejects.toThrow("Please select a valid degree programme.");

    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { warnings: null },
    { warnings: "invalid" },
    { warnings: [null] },
    { warnings: [{ ...warning, type: null }] },
    { warnings: [{ ...warning, severity: "critical" }] },
    { warnings: [{ ...warning, message: null }] },
  ])("rejects malformed response: %j", async (body) => {
    mockResponse(body);

    await expect(
      fetchPreflightWarnings(7)
    ).rejects.toThrow(
      "The server returned an invalid preflight response."
    );
  });

  it("propagates backend errors", async () => {
    mockResponse({ detail: "Degree not found." }, 404);

    await expect(
      fetchPreflightWarnings(999999)
    ).rejects.toMatchObject({
      message: "Degree not found.",
      status: 404,
    });
  });

  it("propagates authorization failures", async () => {
    mockResponse({ detail: "Forbidden" }, 403);

    await expect(
      fetchPreflightWarnings(7)
    ).rejects.toMatchObject({
      status: 403,
    });
  });

  it("propagates network failures", async () => {
    fetch.mockRejectedValue(new Error("Network unavailable"));

    await expect(
      fetchPreflightWarnings(7)
    ).rejects.toThrow("Network unavailable");
  });

  it("forwards the cancellation signal", async () => {
    const controller = new window.AbortController();

    mockResponse({ warnings: [] });

    await fetchPreflightWarnings(7, {
      signal: controller.signal,
    });

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/timetable/preflight?degree_id=7`,
      expect.objectContaining({
        signal: controller.signal,
      })
    );
  });

  it("propagates request cancellation", async () => {
    const controller = new window.AbortController();
    controller.abort();

    const error = new window.DOMException(
      "Request aborted",
      "AbortError"
    );

    fetch.mockRejectedValue(error);

    await expect(
      fetchPreflightWarnings(7, {
        signal: controller.signal,
      })
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("supports an explicitly supplied access token", async () => {
    mockResponse({ warnings: [] });

    await fetchPreflightWarnings(7, {
      token: "explicit-token",
    });

    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/timetable/preflight?degree_id=7`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer explicit-token",
        }),
      })
    );

    expect(supabase.auth.getSession).not.toHaveBeenCalled();
  });
});
