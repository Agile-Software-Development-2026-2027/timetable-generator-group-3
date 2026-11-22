import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ updateUser: vi.fn(), replace: vi.fn() }));
vi.mock("../../../lib/supabase.js", () => ({ supabase: { auth: { updateUser: mocks.updateUser } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

import SetPasswordPage from "../page.jsx";
import { AuthContext } from "../../components/auth-provider.jsx";

function renderPage(auth) {
  return render(<AuthContext.Provider value={{ logOut: vi.fn(), ...auth }}><SetPasswordPage /></AuthContext.Provider>);
}

function choose(password, confirmation = password) {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirmation } });
  fireEvent.click(screen.getByRole("button", { name: "Save password" }));
}

beforeEach(() => {
  mocks.updateUser.mockReset().mockResolvedValue({ data: {}, error: null });
  mocks.replace.mockReset();
});
afterEach(cleanup);

describe("SetPasswordPage", () => {
  it("saves the new password and sends an invited teacher to their home page", async () => {
    renderPage({ status: "signed-in", role: "teacher", email: "ada@unical.it" });
    expect(screen.getByText(/log in as ada@unical.it/)).toBeInTheDocument();
    choose("a-strong-password");
    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({ password: "a-strong-password" }));
    expect(mocks.replace).toHaveBeenCalledWith("/my-schedule");
  });

  it("sends a user without a role to /login after saving", async () => {
    renderPage({ status: "no-role", email: "ada@unical.it" });
    choose("a-strong-password");
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  });

  it("checks the password before sending it", () => {
    renderPage({ status: "signed-in", role: "student" });
    choose("short");
    expect(screen.getByRole("alert")).toHaveTextContent("at least 8");
    choose("a-strong-password", "something-else");
    expect(screen.getByRole("alert")).toHaveTextContent("do not match");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("shows Supabase's error when the password is refused", async () => {
    mocks.updateUser.mockResolvedValue({ data: {}, error: { message: "Password is too weak" } });
    renderPage({ status: "signed-in", role: "student" });
    choose("a-strong-password");
    expect(await screen.findByRole("alert")).toHaveTextContent("Password is too weak");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("asks for the invite link when there is no session", () => {
    renderPage({ status: "signed-out" });
    expect(screen.getByRole("status")).toHaveTextContent("link in your invite email");
    expect(screen.getByRole("link", { name: "Go to log in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });
});
