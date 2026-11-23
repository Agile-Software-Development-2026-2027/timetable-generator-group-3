import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signInWithPassword } = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));
vi.mock("../../../lib/supabase.js", () => ({ supabase: { auth: { signInWithPassword } } }));

import LoginPage from "../page.jsx";
import { AuthContext } from "../../components/auth-provider.jsx";

function renderLogin(auth = { status: "signed-out" }) {
  return render(<AuthContext.Provider value={{ logOut: vi.fn(), ...auth }}><LoginPage /></AuthContext.Provider>);
}

function logIn(email = " ada@unical.it ", password = "secret-pass") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
}

beforeEach(() => signInWithPassword.mockReset());
afterEach(cleanup);

describe("LoginPage", () => {
  it("signs in with Supabase using the email and password", async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: null });
    renderLogin();
    logIn();
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledWith({ email: "ada@unical.it", password: "secret-pass" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["an unknown email", { status: 400, code: "invalid_credentials", message: "Invalid login credentials" }],
    ["a wrong password", { status: 400, code: "invalid_credentials", message: "Invalid login credentials" }],
    ["an unconfirmed email", { status: 400, code: "email_not_confirmed", message: "Email not confirmed" }],
  ])("shows one generic message for %s", async (_case, error) => {
    signInWithPassword.mockResolvedValue({ data: {}, error });
    renderLogin();
    logIn();
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Email or password is incorrect$/);
  });

  it("says when the login service cannot be reached", async () => {
    // supabase-js reports a network failure as an error with status 0 instead of throwing.
    signInWithPassword.mockResolvedValue({ data: {}, error: { status: 0, message: "Failed to fetch" } });
    renderLogin();
    logIn();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the login service");
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
  });

  it("explains when the account has no role", () => {
    renderLogin({ status: "no-role", email: "ada@unical.it" });
    expect(screen.getByRole("status")).toHaveTextContent("Your account has no role yet");
  });

  it("explains when the session has expired", () => {
    renderLogin({ status: "signed-out", expired: true });
    expect(screen.getByRole("status")).toHaveTextContent("Your session has expired");
  });

  it("says when Supabase is not configured", () => {
    renderLogin({ status: "signed-out", unconfigured: true });
    expect(screen.getByRole("status")).toHaveTextContent("NEXT_PUBLIC_SUPABASE_URL");
  });
});
