"use client";

import { useState } from "react";
import { AppNav } from "../components/app-shell.jsx";
import { useAuth } from "../components/auth-provider.jsx";
import { supabase } from "../../lib/supabase.js";
import { loginErrorMessage } from "../../lib/auth-rules.js";

function noticeFor(auth) {
  if (auth.unconfigured) return "Login is not configured yet: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in frontend/.env.local.";
  if (auth.expired) return "Your session has expired. Please log in again.";
  if (auth.status === "no-role") return "Your account has no role yet. Ask the director to give you access.";
  if (auth.status === "error") return `You are signed in, but your account could not be checked: ${auth.message}`;
  return "";
}

export default function LoginPage() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!supabase) return;
    setError("");
    setBusy(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      // On success the session is stored; the AuthProvider then calls
      // GET /auth/me and sends the user to the home page of their role.
      if (signInError) setError(loginErrorMessage(signInError));
    } catch (caught) {
      setError(loginErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const notice = noticeFor(auth);
  return <div className="campus-app">
    <AppNav />
    <main className="container login-main">
      <section className="room-table-panel login-panel" aria-labelledby="login-title">
        <p className="eyebrow mb-2">UNIVERSITY OF CALABRIA / TIMETABLE</p>
        <h1 id="login-title" className="h3 fw-semibold mb-1">Log in</h1>
        <p className="text-secondary mb-4">Use the email and password of your account.</p>
        {notice && <p className="login-notice" role="status">{notice}</p>}
        {error && <p className="login-error" role="alert">{error}</p>}
        <form onSubmit={submit} className="d-grid gap-3">
          <div>
            <label className="form-label" htmlFor="login-email">Email</label>
            <input id="login-email" type="email" className="form-control" autoComplete="email" required
              value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div>
            <label className="form-label" htmlFor="login-password">Password</label>
            <input id="login-password" type="password" className="form-control" autoComplete="current-password" required
              value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <button type="submit" className="btn btn-campus" disabled={busy || !supabase}>{busy ? "Logging in…" : "Log in"}</button>
        </form>
      </section>
    </main>
  </div>;
}
