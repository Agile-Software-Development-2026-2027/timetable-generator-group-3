import { supabase } from "./supabase.js";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function accessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function errorMessage(body, status) {
  const detail = body?.detail;
  if (Array.isArray(detail)) return detail.map((issue) => issue.msg).join(" ");
  if (typeof detail === "string" && detail) return detail;
  return `Request failed (${status}).`;
}

// Every call to the backend goes through here, so each one carries the user's
// access token. Pass `token` to use a specific one instead of the stored session.
export async function apiRequest(path, { token, headers, ...options } = {}) {
  const bearer = token === undefined ? await accessToken() : token;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(errorMessage(body, response.status));
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}


// KAN-67: check the selected degree before timetable generation.
export async function fetchPreflightWarnings(degreeId, options = {}) {
  const id = Number(degreeId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Please select a valid degree programme.");
  }

  const { semesterId, ...requestOptions } = options;
  let path = `/timetable/preflight?degree_id=${encodeURIComponent(id)}`;

  if (semesterId !== undefined && semesterId !== null && semesterId !== "") {
    const semester = Number(semesterId);

    if (!Number.isSafeInteger(semester) || semester <= 0) {
      throw new Error("Please select a valid semester.");
    }

    path += `&semester_id=${encodeURIComponent(semester)}`;
  }

  const result = await apiRequest(path, requestOptions);

  if (!Array.isArray(result?.warnings) || result.warnings.some(
    (warning) => !warning
      || typeof warning.type !== "string"
      || !["error", "warning"].includes(warning.severity)
      || typeof warning.message !== "string"
  )) {
    throw new Error("The server returned an invalid preflight response.");
  }

  return result.warnings;
}
