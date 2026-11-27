import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from "../api.js";
import {
  fetchTeacherPreferences,
  saveTeacherPreferences,
} from "../teacher-preferences-api.js";

const preferences = {
  max_hours_per_day: 4,
  max_teaching_days: 3,
  max_consecutive_hours: 2,
  preferred_part_of_day: "morning",
};

const emptyPreferences = {
  max_hours_per_day: null,
  max_teaching_days: null,
  max_consecutive_hours: null,
  preferred_part_of_day: null,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Teacher preferences API client", () => {
  it("loads preferences through the shared API client", async () => {
    apiRequest.mockResolvedValue(preferences);

    expect(await fetchTeacherPreferences(45)).toEqual(preferences);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith(
      "/teachers/45/preferences"
    );
  });

  it("loads unset preferences", async () => {
    const request = vi.fn().mockResolvedValue(emptyPreferences);

    expect(await fetchTeacherPreferences(45, request))
      .toEqual(emptyPreferences);

    expect(request).toHaveBeenCalledWith(
      "/teachers/45/preferences"
    );
  });

  it("saves all four preference fields using PUT", async () => {
    apiRequest.mockResolvedValue(preferences);

    expect(await saveTeacherPreferences(45, preferences))
      .toEqual(preferences);

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith(
      "/teachers/45/preferences",
      {
        method: "PUT",
        body: JSON.stringify(preferences),
      }
    );
  });

  it("allows all preferences to be cleared", async () => {
    const request = vi.fn().mockResolvedValue(emptyPreferences);

    expect(await saveTeacherPreferences(
      45, emptyPreferences, request
    )).toEqual(emptyPreferences);

    expect(request).toHaveBeenCalledWith(
      "/teachers/45/preferences",
      {
        method: "PUT",
        body: JSON.stringify(emptyPreferences),
      }
    );
  });

  it("preserves an explicit no-preference value", async () => {
    const data = {
      ...preferences,
      preferred_part_of_day: "none",
    };
    const request = vi.fn().mockResolvedValue(data);

    expect(await saveTeacherPreferences(45, data, request))
      .toEqual(data);

    expect(request).toHaveBeenCalledWith(
      "/teachers/45/preferences",
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    );
  });

  it.each([
    0, -1, "45", true, 2.5,
    null, undefined, NaN, Infinity,
  ])(
    "rejects invalid teacher ID %s without making requests",
    async (teacherId) => {
      const request = vi.fn();

      await expect(fetchTeacherPreferences(teacherId, request))
        .rejects.toThrow("Teacher ID must be a positive integer.");

      await expect(saveTeacherPreferences(
        teacherId, preferences, request
      )).rejects.toThrow("Teacher ID must be a positive integer.");

      expect(request).not.toHaveBeenCalled();
    }
  );

  it.each([401, 403, 404])(
    "propagates load errors with status %s",
    async (status) => {
      const error = Object.assign(
        new Error("Could not load preferences"),
        { status }
      );
      const request = vi.fn().mockRejectedValue(error);

      await expect(fetchTeacherPreferences(45, request))
        .rejects.toBe(error);

      expect(request).toHaveBeenCalledTimes(1);
    }
  );

  it.each([401, 403, 404, 422, 500])(
    "propagates save errors with status %s",
    async (status) => {
      const error = Object.assign(
        new Error("Could not save preferences"),
        { status }
      );
      const request = vi.fn().mockRejectedValue(error);

      await expect(saveTeacherPreferences(
        45, preferences, request
      )).rejects.toBe(error);

      expect(request).toHaveBeenCalledTimes(1);
    }
  );
});
