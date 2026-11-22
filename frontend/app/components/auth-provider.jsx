"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase.js";
import { apiRequest } from "../../lib/api.js";
import { LOGIN_PATH, SET_PASSWORD_PATH, redirectFor } from "../../lib/auth-rules.js";

// Without a provider (e.g. a page rendered on its own in a test) nobody is signed in.
export const AuthContext = createContext({ status: "signed-out", logOut: async () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

// Ask the backend who owns the session: GET /auth/me gives the role.
export async function loadAuth(session) {
  if (!session) return { status: "signed-out" };
  const email = session.user?.email ?? "";
  try {
    const me = await apiRequest("/auth/me", { token: session.access_token });
    return { status: "signed-in", email, role: me.role, me };
  } catch (error) {
    if (error.status === 401) return { status: "signed-out", expired: true };
    if (error.status === 403) return { status: "no-role", email };
    return { status: "error", email, message: error.message };
  }
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  // If Supabase cannot be reached, still forget the session in this browser.
  if (error) await supabase.auth.signOut({ scope: "local" });
}

export function AuthProvider({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [auth, setAuth] = useState({ status: "loading" });

  useEffect(() => {
    if (!supabase) {
      setAuth({ status: "signed-out", unconfigured: true });
      return undefined;
    }
    let active = true;
    let latest = 0;
    // Fires once with the stored session, then on every sign-in and sign-out.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") return;
      const call = ++latest;
      // Supabase asks not to await its own calls inside this callback, so the
      // work runs right after it returns.
      window.setTimeout(async () => {
        const next = await loadAuth(session);
        if (!active || call !== latest) return;
        if (next.expired) await supabase.auth.signOut({ scope: "local" });
        setAuth(next);
      }, 0);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const target = redirectFor(pathname, auth);
  useEffect(() => {
    if (target && target !== pathname) router.replace(target);
  }, [target, pathname, router]);

  async function logOut() {
    await signOut();
    router.replace(LOGIN_PATH);
  }

  const value = { ...auth, logOut };
  const isAuthPage = pathname === LOGIN_PATH || pathname === SET_PASSWORD_PATH;
  let content = children;
  if (auth.status === "loading" || target) {
    content = <p className="auth-status text-secondary" role="status">Checking your session…</p>;
  } else if (auth.status === "error" && !isAuthPage) {
    content = <section className="auth-status room-table-panel" role="alert">
      <p className="fw-semibold mb-1">Your account could not be checked</p>
      <p className="text-secondary small mb-3">{auth.message} Check that the API is running, then refresh the page.</p>
      <button type="button" className="btn btn-outline-secondary btn-sm" onClick={logOut}>Log out</button>
    </section>;
  }
  return <AuthContext.Provider value={value}>{content}</AuthContext.Provider>;
}
