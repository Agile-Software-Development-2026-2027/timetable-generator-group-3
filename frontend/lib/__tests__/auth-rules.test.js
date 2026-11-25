import { describe, expect, it } from "vitest";
import {
  WRONG_CREDENTIALS, canVisit, homeFor, inviteLinkError, loginErrorMessage, navLinksFor, newPasswordError, redirectFor,
} from "../auth-rules.js";

const BACKOFFICE = ["/", "/rooms", "/courses", "/calendar", "/settings", "/data-loader", "/teachers", "/students", "/users"];
const signedIn = (role) => ({ status: "signed-in", role });

describe("homeFor", () => {
  it.each([["director", "/"], ["teacher", "/my-schedule"], ["student", "/my-timetable"]])("sends a %s to %s", (role, home) => {
    expect(homeFor(role)).toBe(home);
  });

  it("sends an unknown role to the login page", () => {
    expect(homeFor(undefined)).toBe("/login");
  });
});

describe("canVisit", () => {
  it.each(BACKOFFICE)("lets a director open %s", (path) => {
    expect(canVisit("director", path)).toBe(true);
  });

  it.each(BACKOFFICE.flatMap((path) => [["teacher", path], ["student", path]]))("keeps a %s out of %s", (role, path) => {
    expect(canVisit(role, path)).toBe(false);
  });

  it("covers pages below an allowed path", () => {
    expect(canVisit("director", "/rooms/12")).toBe(true);
    expect(canVisit("teacher", "/my-schedule/week")).toBe(true);
  });

  it("does not treat a shared prefix as the same page", () => {
    expect(canVisit("director", "/roomsfoo")).toBe(false);
  });

  it("keeps each role out of the other roles' home pages", () => {
    expect(canVisit("teacher", "/my-timetable")).toBe(false);
    expect(canVisit("student", "/my-schedule")).toBe(false);
    expect(canVisit("director", "/my-schedule")).toBe(false);
  });
});

describe("redirectFor", () => {
  it("waits while the session is being checked", () => {
    expect(redirectFor("/rooms", { status: "loading" })).toBeNull();
    expect(redirectFor("/login", { status: "loading" })).toBeNull();
  });

  it.each(["/", "/rooms", "/students", "/my-schedule", "/my-timetable"])("sends a visitor without a session from %s to /login", (path) => {
    expect(redirectFor(path, { status: "signed-out" })).toBe("/login");
  });

  it("sends a user without a role to /login", () => {
    expect(redirectFor("/rooms", { status: "no-role" })).toBe("/login");
  });

  it("shows the login page to a visitor without a session or role", () => {
    expect(redirectFor("/login", { status: "signed-out" })).toBeNull();
    expect(redirectFor("/login", { status: "no-role" })).toBeNull();
  });

  it.each([["director", "/"], ["teacher", "/my-schedule"], ["student", "/my-timetable"]])(
    "sends a signed-in %s from /login to %s", (role, home) => {
      expect(redirectFor("/login", signedIn(role))).toBe(home);
    });

  it.each(BACKOFFICE.flatMap((path) => [["teacher", path, "/my-schedule"], ["student", path, "/my-timetable"]]))(
    "sends a %s who opens %s to %s", (role, path, home) => {
      expect(redirectFor(path, signedIn(role))).toBe(home);
    });

  it("shows each role its own pages", () => {
    expect(redirectFor("/rooms", signedIn("director"))).toBeNull();
    expect(redirectFor("/my-schedule", signedIn("teacher"))).toBeNull();
    expect(redirectFor("/my-timetable", signedIn("student"))).toBeNull();
  });

  it("stays on the page when the API could not be reached", () => {
    expect(redirectFor("/rooms", { status: "error" })).toBeNull();
  });

  it("always shows the set-password page so an invite link can be used", () => {
    expect(redirectFor("/set-password", { status: "signed-out" })).toBeNull();
    expect(redirectFor("/set-password", signedIn("teacher"))).toBeNull();
  });
});

describe("navLinksFor", () => {
  it("gives each role only its own links", () => {
    expect(navLinksFor("director").map(([href]) => href)).toEqual(["/", "/rooms", "/teachers", "/students", "/courses", "/data-loader", "/calendar", "/settings", "/users"]);
    expect(navLinksFor("teacher")).toEqual([["/my-schedule", "My schedule"]]);
    expect(navLinksFor("student")).toEqual([["/my-timetable", "My timetable"]]);
    expect(navLinksFor(undefined)).toEqual([]);
  });
});

describe("loginErrorMessage", () => {
  it.each([400, 401, 422])("gives one generic message for a %s answer", (status) => {
    expect(loginErrorMessage({ status, message: "Invalid login credentials" })).toBe(WRONG_CREDENTIALS);
  });

  it("does not say which field was wrong", () => {
    expect(WRONG_CREDENTIALS).toBe("Email or password is incorrect");
  });

  it("explains rate limits and connection problems separately", () => {
    expect(loginErrorMessage({ status: 429 })).toMatch(/Too many attempts/);
    expect(loginErrorMessage({ status: 0 })).toMatch(/Could not reach/);
    expect(loginErrorMessage(new TypeError("Failed to fetch"))).toMatch(/Could not reach/);
  });
});

describe("newPasswordError", () => {
  it("asks for at least 8 characters and matching passwords", () => {
    expect(newPasswordError("short", "short")).toMatch(/at least 8/);
    expect(newPasswordError("long enough", "different")).toBe("The passwords do not match.");
    expect(newPasswordError("long enough", "long enough")).toBe("");
  });
});

describe("inviteLinkError", () => {
  it("reads the reason Supabase puts in the link", () => {
    expect(inviteLinkError("#error=access_denied&error_description=Email+link+is+invalid+or+has+expired"))
      .toBe("Email link is invalid or has expired");
    expect(inviteLinkError("#access_token=abc&type=invite")).toBe("");
    expect(inviteLinkError("")).toBe("");
  });
});


describe("KAN-59 student management permissions", () => {
  it("allows directors to open the Students page", () => {
    expect(redirectFor("/students", signedIn("director"))).toBeNull();
  });

  it("protects nested student management routes", () => {
    expect(canVisit("director", "/students/12")).toBe(true);
    expect(canVisit("teacher", "/students/12")).toBe(false);
    expect(canVisit("student", "/students/12")).toBe(false);
  });

  it("does not allow unrelated paths with the same prefix", () => {
    expect(canVisit("director", "/studentsfoo")).toBe(false);
  });

  it("shows the Students navigation link only to directors", () => {
    expect(navLinksFor("director")).toContainEqual([
      "/students", "Students",
    ]);

    expect(navLinksFor("teacher").map(([href]) => href))
      .not.toContain("/students");

    expect(navLinksFor("student").map(([href]) => href))
      .not.toContain("/students");
  });
});
