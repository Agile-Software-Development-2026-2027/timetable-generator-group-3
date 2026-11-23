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
