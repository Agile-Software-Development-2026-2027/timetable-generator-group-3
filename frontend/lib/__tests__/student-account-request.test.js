import { describe, expect, it, vi } from "vitest";
import { createStudentAccountRequest } from "../student-account-request.js";

const accountA = {
  user: { id: "account-a" },
  access_token: "token-a",
};

const accountB = {
  user: { id: "account-b" },
  access_token: "token-b",
};

describe("Student account-bound requests", () => {
  it("uses the matching account token explicitly", async () => {
    const getSession = vi.fn().mockResolvedValue(accountA);
    const request = vi.fn().mockResolvedValue([]);

    const scopedRequest = createStudentAccountRequest(
      "account-a", getSession, request
    );

    expect(await scopedRequest("/students/me/courses")).toEqual([]);

    expect(request).toHaveBeenCalledWith(
      "/students/me/courses",
      { token: "token-a" }
    );
  });

  it("rejects a different account before sending a request", async () => {
    const getSession = vi.fn().mockResolvedValue(accountB);
    const request = vi.fn();

    const scopedRequest = createStudentAccountRequest(
      "account-a", getSession, request
    );

    await expect(scopedRequest("/students/me/courses"))
      .rejects.toThrow("Your account changed");

    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a missing session", async () => {
    const getSession = vi.fn().mockResolvedValue(null);
    const request = vi.fn();

    const scopedRequest = createStudentAccountRequest(
      "account-a", getSession, request
    );

    await expect(scopedRequest("/students/me/courses"))
      .rejects.toThrow("Your account changed");

    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a session without an access token", async () => {
    const getSession = vi.fn().mockResolvedValue({
      user: { id: "account-a" },
    });

    const request = vi.fn();
    const scopedRequest = createStudentAccountRequest(
      "account-a", getSession, request
    );

    await expect(scopedRequest("/students/me/courses"))
      .rejects.toThrow("Your account changed");

    expect(request).not.toHaveBeenCalled();
  });

  it("discards a response after switching accounts", async () => {
    const getSession = vi.fn()
      .mockResolvedValueOnce(accountA)
      .mockResolvedValueOnce(accountB);

    const request = vi.fn().mockResolvedValue([
      { id: 1, name: "Private course" },
    ]);

    const scopedRequest = createStudentAccountRequest(
      "account-a", getSession, request
    );

    await expect(scopedRequest("/students/me/courses"))
      .rejects.toThrow("Your account changed");

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("discards a response after signing out", async () => {
    const getSession = vi.fn()
      .mockResolvedValueOnce(accountA)
      .mockResolvedValueOnce(null);

    const request = vi.fn().mockResolvedValue([]);

    const scopedRequest = createStudentAccountRequest(
      "account-a", getSession, request
    );

    await expect(scopedRequest("/students/me/timetable"))
      .rejects.toThrow("Your account changed");
  });

  it("prevents subsequent pagination requests using another account", async () => {
    const getSession = vi.fn()
      .mockResolvedValueOnce(accountA)
      .mockResolvedValueOnce(accountA)
      .mockResolvedValueOnce(accountB);

    const request = vi.fn().mockResolvedValue([]);

    const scopedRequest = createStudentAccountRequest(
      "account-a", getSession, request
    );

    await scopedRequest("/students/me/timetable?page=1");

    await expect(scopedRequest("/students/me/timetable?page=2"))
      .rejects.toThrow("Your account changed");

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("supports refreshed tokens for the same account", async () => {
    const refreshed = {
      ...accountA,
      access_token: "refreshed-token-a",
    };

    const getSession = vi.fn()
      .mockResolvedValueOnce(accountA)
      .mockResolvedValueOnce(refreshed)
      .mockResolvedValueOnce(refreshed)
      .mockResolvedValueOnce(refreshed);

    const request = vi.fn().mockResolvedValue([]);

    const scopedRequest = createStudentAccountRequest(
      "account-a", getSession, request
    );

    await scopedRequest("/students/me/timetable?page=1");
    await scopedRequest("/students/me/timetable?page=2");

    expect(request).toHaveBeenNthCalledWith(
      1,
      "/students/me/timetable?page=1",
      { token: "token-a" }
    );

    expect(request).toHaveBeenNthCalledWith(
      2,
      "/students/me/timetable?page=2",
      { token: "refreshed-token-a" }
    );
  });

  it("preserves enrollment options and uses the verified token", async () => {
    const getSession = vi.fn().mockResolvedValue(accountA);
    const request = vi.fn().mockResolvedValue(null);

    const scopedRequest = createStudentAccountRequest(
      "account-a", getSession, request
    );

    await scopedRequest("/students/me/enrollments", {
      method: "POST",
      body: JSON.stringify({ course_id: 3 }),
      token: "untrusted-token",
    });

    expect(request).toHaveBeenCalledWith(
      "/students/me/enrollments",
      {
        method: "POST",
        body: JSON.stringify({ course_id: 3 }),
        token: "token-a",
      }
    );
  });

  it("preserves backend authorization errors", async () => {
    const getSession = vi.fn().mockResolvedValue(accountA);
    const error = Object.assign(new Error("Forbidden"), {
      status: 403,
    });

    const request = vi.fn().mockRejectedValue(error);

    const scopedRequest = createStudentAccountRequest(
      "account-a", getSession, request
    );

    await expect(scopedRequest("/students/me/timetable"))
      .rejects.toBe(error);
  });

  it.each(["", " ", null, undefined])(
    "rejects invalid account identity %s",
    (accountId) => {
      expect(() => createStudentAccountRequest(accountId))
        .toThrow("A valid student account is required.");
    }
  );
});
