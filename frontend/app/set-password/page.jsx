"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound } from "lucide-react";
import { AuthLayout } from "../components/auth-layout.jsx";
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
  return <AuthLayout eyebrow="WELCOME TO UNICAL" headline={<>Your next<br />chapter starts here.</>}
    tagline="Create a secure password to activate your timetable account." icon={<KeyRound size={22} />}>
    <div className="eyebrow">ACCOUNT SETUP</div>
    <h2 id="set-password-title">Set your password</h2>
    {!hasSession ? <>
      <p className="login-notice" role="status">
        {linkError ? `${linkError}. ` : ""}Open this page from the link in your invite email. If the link has expired, ask the director for a new invite.
      </p>
      <Link className="button button-primary login-submit" href={LOGIN_PATH}>Go to log in</Link>
    </> : <>
      <p>Choose the password you will use to log in{auth.email ? ` as ${auth.email}` : ""}.</p>
      {error && <p className="login-error" role="alert">{error}</p>}
      <form onSubmit={submit} aria-labelledby="set-password-title" noValidate>
        <label htmlFor="new-password">New password</label>
        <input id="new-password" type="password" autoComplete="new-password"
          aria-describedby="new-password-hint" value={password} onChange={(event) => setPassword(event.target.value)} />
        <div id="new-password-hint" className="field-hint">At least {MIN_PASSWORD_LENGTH} characters.</div>
        <label htmlFor="confirm-password">Confirm password</label>
        <input id="confirm-password" type="password" autoComplete="new-password"
          value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        <button type="submit" className="button button-primary login-submit" disabled={busy}>{busy ? "Saving…" : <>Save password <ArrowRight size={16} aria-hidden="true" /></>}</button>
      </form>
    </>}
  </AuthLayout>;
}
