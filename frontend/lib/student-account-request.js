import { apiRequest } from "./api.js";
import { supabase } from "./supabase.js";

async function readSession() {
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  return data.session ?? null;
}

export function createStudentAccountRequest(
  accountId,
  getSession = readSession,
  request = apiRequest
) {
  if (typeof accountId !== "string" || !accountId.trim()) {
    throw new Error("A valid student account is required.");
  }

  async function requireSession() {
    const session = await getSession();

    if (
      session?.user?.id !== accountId ||
      typeof session.access_token !== "string" ||
      !session.access_token
    ) {
      throw new Error("Your account changed. Please sign in again.");
    }

    return session;
  }

  return async function accountRequest(path, options = {}) {
    const session = await requireSession();

    const result = await request(path, {
      ...options,
      token: session.access_token,
    });

    await requireSession();

    return result;
  };
}
