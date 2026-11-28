"use client";

import { useState } from "react";
import { ArrowRight, CalendarDays } from "lucide-react";
import { AuthLayout } from "../components/auth-layout.jsx";
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
  return <AuthLayout eyebrow="UNIVERSITY OF CALABRIA" headline={<>Make room<br />for what&apos;s next.</>}
    tagline="A smarter way to plan the moments that make a semester." icon={<CalendarDays size={22} />}>
    <div className="eyebrow">WELCOME BACK</div>
    <h2 id="login-title">Log in to your account</h2>
    <p>Use the email and password of your account.</p>
    {notice && <p className="login-notice" role="status">{notice}</p>}
    {error && <p className="login-error" role="alert">{error}</p>}
    <form onSubmit={submit} aria-labelledby="login-title">
      <label htmlFor="login-email">Email</label>
      <input id="login-email" type="email" autoComplete="email" required
        value={email} onChange={(event) => setEmail(event.target.value)} />
      <label htmlFor="login-password">Password</label>
      <input id="login-password" type="password" autoComplete="current-password" required
        value={password} onChange={(event) => setPassword(event.target.value)} />
      <button type="submit" className="button button-primary login-submit" disabled={busy || !supabase}>{busy ? "Logging in…" : <>Log in <ArrowRight size={16} aria-hidden="true" /></>}</button>
    </form>
    <div className="account-note"><span className="note-rule" />Accounts are created by your programme director.<span className="note-rule" /></div>
  </AuthLayout>;
}
