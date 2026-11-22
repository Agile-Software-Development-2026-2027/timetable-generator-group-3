"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "../components/app-shell.jsx";
import { useAuth } from "../components/auth-provider.jsx";
import { supabase } from "../../lib/supabase.js";
import { LOGIN_PATH, MIN_PASSWORD_LENGTH, homeFor, inviteLinkError, newPasswordError } from "../../lib/auth-rules.js";

// The invite email (KAN-69) links here. Supabase reads the token from the link
// and signs the user in; they then choose the password they log in with.
export default function SetPasswordPage() {
  const auth = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [linkError, setLinkError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setLinkError(inviteLinkError(window.location.hash)); }, []);

  async function submit(event) {
    event.preventDefault();
    const problem = newPasswordError(password, confirmation);
    setError(problem);
    if (problem) return;
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return;
    }
    router.replace(auth.status === "signed-in" ? homeFor(auth.role) : LOGIN_PATH);
  }

  const hasSession = auth.status !== "signed-out";
  return <div className="campus-app">
    <AppNav />
    <main className="container login-main">
      <section className="room-table-panel login-panel" aria-labelledby="set-password-title">
        <p className="eyebrow mb-2">UNIVERSITY OF CALABRIA / TIMETABLE</p>
        <h1 id="set-password-title" className="h3 fw-semibold mb-1">Set your password</h1>
        {!hasSession ? <>
          <p className="login-notice" role="status">
            {linkError ? `${linkError}. ` : ""}Open this page from the link in your invite email. If the link has expired, ask the director for a new invite.
          </p>
          <Link className="btn btn-campus w-100" href={LOGIN_PATH}>Go to log in</Link>
        </> : <>
          <p className="text-secondary mb-4">Choose the password you will use to log in{auth.email ? ` as ${auth.email}` : ""}.</p>
          {error && <p className="login-error" role="alert">{error}</p>}
          <form onSubmit={submit} className="d-grid gap-3" noValidate>
            <div>
              <label className="form-label" htmlFor="new-password">New password</label>
              <input id="new-password" type="password" className="form-control" autoComplete="new-password"
                aria-describedby="new-password-hint" value={password} onChange={(event) => setPassword(event.target.value)} />
              <div id="new-password-hint" className="form-text">At least {MIN_PASSWORD_LENGTH} characters.</div>
            </div>
            <div>
              <label className="form-label" htmlFor="confirm-password">Confirm password</label>
              <input id="confirm-password" type="password" className="form-control" autoComplete="new-password"
                value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            </div>
            <button type="submit" className="btn btn-campus" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
          </form>
        </>}
      </section>
    </main>
  </div>;
}
