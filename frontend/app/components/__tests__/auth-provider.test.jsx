import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/rooms",
  replace: vi.fn(),
  listener: null,
  signOut: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      signOut: mocks.signOut,
      onAuthStateChange: (callback) => {
        mocks.listener = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));

import { AuthProvider, useAuth } from "../auth-provider.jsx";

const session = { access_token: "token-1", user: { email: "ada@unical.it" } };

function meReplies(status, body) {
  global.fetch = vi.fn(() => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) }));
}

function Page() {
  const auth = useAuth();
  return <p>Protected page for {auth.email} ({auth.role}) <button type="button" onClick={auth.logOut}>Log out</button></p>;
}

async function renderAt(pathname, currentSession = session) {
  mocks.pathname = pathname;
  render(<AuthProvider><Page /></AuthProvider>);
  await act(async () => mocks.listener("INITIAL_SESSION", currentSession));
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.signOut.mockReset().mockResolvedValue({ error: null });
  mocks.getSession.mockResolvedValue({ data: { session } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AuthProvider", () => {
  it("hides the page while the session is checked", () => {
    mocks.pathname = "/rooms";
    render(<AuthProvider><Page /></AuthProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
    expect(screen.queryByText(/Protected page/)).not.toBeInTheDocument();
  });

  it("sends a visitor without a session to /login without calling the API", async () => {
    global.fetch = vi.fn();
    await renderAt("/rooms", null);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText(/Protected page/)).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("asks GET /auth/me with the session's token and shows the page to a director", async () => {
    meReplies(200, { id: "u1", role: "director" });
    await renderAt("/rooms");
    expect(await screen.findByText("Protected page for ada@unical.it (director)", { exact: false })).toBeInTheDocument();
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/auth\/me$/);
    expect(options.headers.Authorization).toBe("Bearer token-1");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it.each([["teacher", "/my-schedule"], ["student", "/my-timetable"]])("sends a %s away from a backoffice page to %s", async (role, home) => {
    meReplies(200, { id: "u1", role });
    await renderAt("/courses");
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(home));
    expect(screen.queryByText(/Protected page/)).not.toBeInTheDocument();
  });

  it("sends a signed-in user from /login to their home page", async () => {
    meReplies(200, { id: "u1", role: "teacher" });
    await renderAt("/login");
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/my-schedule"));
  });

  it("signs out and sends the user to /login when /auth/me returns 401", async () => {
    meReplies(401, { detail: "Not authenticated" });
    await renderAt("/rooms");
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("sends a user without a role to /login", async () => {
    meReplies(403, { detail: "User has no role assigned" });
    await renderAt("/rooms");
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  });

  it("explains when the account cannot be checked instead of showing the page", async () => {
    global.fetch = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    await renderAt("/rooms");
    expect(await screen.findByRole("alert")).toHaveTextContent("Your account could not be checked");
    expect(screen.queryByText(/Protected page/)).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("logs out through Supabase and goes to /login", async () => {
    meReplies(200, { id: "u1", role: "director" });
    await renderAt("/rooms");
    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(mocks.signOut).toHaveBeenCalledWith();
  });

  it("still forgets the session in this browser when Supabase cannot be reached on log out", async () => {
    meReplies(200, { id: "u1", role: "director" });
    mocks.signOut.mockResolvedValueOnce({ error: new Error("offline") }).mockResolvedValue({ error: null });
    await renderAt("/rooms");
    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" }));
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });
});
