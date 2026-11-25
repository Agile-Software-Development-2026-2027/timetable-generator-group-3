// Which pages each role may open, where each role lands, and which links it sees.

export const ROLE_HOME = { director: "/", teacher: "/my-schedule", student: "/my-timetable" };

const BACKOFFICE_PATHS = ["/", "/rooms", "/courses", "/calendar", "/settings", "/data-loader", "/teachers", "/students", "/users"];

const ROLE_PATHS = {
  director: BACKOFFICE_PATHS,
  teacher: ["/my-schedule"],
  student: ["/my-timetable"],
};

// Single source of truth for the header: a role always sees its links in this
// order, so buttons never shift or disappear when navigating.
export const NAV_LINKS_BY_ROLE = {
  director: [["/", "Degree programmes"], ["/rooms", "Rooms"], ["/teachers", "Teachers"], ["/students", "Students"], ["/courses", "Courses"], ["/data-loader", "Data Loader"], ["/calendar", "Open timetable"], ["/settings", "Slot configuration"], ["/users", "Users"]],
  teacher: [["/my-schedule", "My schedule"]],
  student: [["/my-timetable", "My timetable"]],
};

export const LOGIN_PATH = "/login";
// Where an invited user lands from the invite email to choose a password.
export const SET_PASSWORD_PATH = "/set-password";

export function homeFor(role) {
  return ROLE_HOME[role] ?? LOGIN_PATH;
}

export function navLinksFor(role) {
  return NAV_LINKS_BY_ROLE[role] ?? [];
}

function isWithin(pathname, base) {
  return base === "/" ? pathname === "/" : pathname === base || pathname.startsWith(`${base}/`);
}

export function canVisit(role, pathname) {
  return (ROLE_PATHS[role] ?? []).some((base) => isWithin(pathname, base));
}

// Where to send someone on `pathname`, or null to show the page.
// `auth.status` is "loading", "signed-out", "no-role", "error" or "signed-in".
export function redirectFor(pathname, auth) {
  if (auth.status === "loading" || pathname === SET_PASSWORD_PATH) return null;
  if (pathname === LOGIN_PATH) return auth.status === "signed-in" ? homeFor(auth.role) : null;
  if (auth.status === "signed-in") return canVisit(auth.role, pathname) ? null : homeFor(auth.role);
  // Stay put and explain: the session may be fine but the API could not be reached.
  if (auth.status === "error") return null;
  return LOGIN_PATH;
}

export const MIN_PASSWORD_LENGTH = 8;

export function newPasswordError(password, confirmation) {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirmation) return "The passwords do not match.";
  return "";
}

// Supabase puts the reason in the URL hash when an invite link is invalid or expired.
export function inviteLinkError(hash) {
  const match = /[#&]error_description=([^&]*)/.exec(hash || "");
  return match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
}

export const WRONG_CREDENTIALS = "Email or password is incorrect";

// Supabase answers a wrong email and a wrong password the same way; the message
// must not tell them apart either.
export function loginErrorMessage(error) {
  if (error?.status === 429) return "Too many attempts. Wait a moment and try again.";
  if (error?.status >= 400 && error.status < 500) return WRONG_CREDENTIALS;
  return "Could not reach the login service. Check your connection and try again.";
}
