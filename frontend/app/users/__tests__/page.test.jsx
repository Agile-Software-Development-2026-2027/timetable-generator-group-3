import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { apiRequest } from "../../../lib/api.js";
import { AuthContext } from "../../components/auth-provider.jsx";
import UsersPage from "../page.jsx";

vi.mock("../../../lib/api.js", () => ({ apiRequest: vi.fn() }));

const me = { id: "u-director", email: "director@unical.it", role: "director", teacher_id: null, student_id: null, linked_name: null, status: "active" };
const ada = { id: "u-ada", email: "ada@unical.it", role: "teacher", teacher_id: 1, student_id: null, linked_name: "Ada Lovelace", status: "invited" };
const grace = { id: "u-grace", email: "grace@unical.it", role: "student", teacher_id: null, student_id: 7, linked_name: "Grace Hopper (M100)", status: "active" };
const teachers = [{ id: 1, name: "Ada Lovelace" }, { id: 2, name: "Alan Turing" }];
const students = [{ id: 7, name: "Grace Hopper", student_number: "M100" }, { id: 8, name: "Emmy Noether", student_number: "M200" }];

// The lists arrive a little late, like on a slow CI runner, so the tests must
// wait for the page to finish loading instead of relying on timing.
const later = (value) => new Promise((resolve) => setTimeout(() => resolve(value), 30));

function mockApi(overrides = {}) {
  apiRequest.mockImplementation((path, options = {}) => {
    const key = `${options.method ?? "GET"} ${path}`;
    if (key in overrides) return overrides[key](options);
    if (path === "/users") return later([ada, me, grace]);
    if (path === "/teachers") return later(teachers);
    if (path === "/students") return later(students);
    return Promise.reject(new Error(`Unexpected ${key}`));
  });
}

function renderPage() {
  render(<AuthContext.Provider value={{ status: "signed-in", role: "director", email: me.email, me: { id: me.id }, logOut: vi.fn() }}>
    <UsersPage />
  </AuthContext.Provider>);
}

const row = (email) => screen.getByRole("rowheader", { name: new RegExp(email) }).closest("tr");
const sentBody = (method) => JSON.parse(apiRequest.mock.calls.find(([, options]) => options?.method === method)[1].body);

// The button is disabled until the accounts have loaded; on a slow CI runner it
// can be found before that, so wait for it to be enabled before clicking.
async function openInviteForm() {
  const button = await screen.findByRole("button", { name: "Invite user" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

beforeEach(() => mockApi());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UsersPage", () => {
  it("lists accounts with their role, linked record and status", async () => {
    renderPage();

    const adaRow = within(await screen.findByRole("rowheader", { name: /ada@unical.it/ }).then((cell) => cell.closest("tr")));
    expect(adaRow.getByText("Teacher")).toBeInTheDocument();
    expect(adaRow.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(adaRow.getByText("Invite sent")).toBeInTheDocument();
    expect(within(row("grace@unical.it")).getByText("Grace Hopper (M100)")).toBeInTheDocument();
    expect(within(row("director@unical.it")).getByText("Programme director")).toBeInTheDocument();
  });

  it("marks your own account and does not let you deactivate it", async () => {
    renderPage();

    const own = within(await screen.findByRole("rowheader", { name: /director@unical.it/ }).then((cell) => cell.closest("tr")));
    expect(own.getByText("(you)")).toBeInTheDocument();
    expect(own.getByRole("button", { name: /Deactivate/ })).toBeDisabled();
    expect(within(row("ada@unical.it")).getByRole("button", { name: /Deactivate/ })).toBeEnabled();
  });

  it("invites a teacher, offering only teachers without an account", async () => {
    const invited = { id: "u-alan", email: "alan@unical.it", role: "teacher", teacher_id: 2, student_id: null, linked_name: "Alan Turing", status: "invited" };
    mockApi({ "POST /users": () => Promise.resolve(invited) });
    renderPage();

    await openInviteForm();
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Email"), { target: { value: " Alan@Unical.it " } });
    const teacherSelect = dialog.getByLabelText("Teacher");
    expect(within(teacherSelect).getAllByRole("option").map((option) => option.textContent)).toEqual(["Select teacher", "Alan Turing"]);
    fireEvent.change(teacherSelect, { target: { value: "2" } });
    fireEvent.click(dialog.getByRole("button", { name: "Send invitation" }));

    expect(await screen.findByText("Invitation sent to alan@unical.it.")).toBeInTheDocument();
    expect(sentBody("POST")).toEqual({ email: "alan@unical.it", role: "teacher", teacher_id: 2, student_id: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(row("alan@unical.it")).getByText("Alan Turing")).toBeInTheDocument();
  });

  it("shows a student selector with matricola for the student role, and none for directors", async () => {
    renderPage();

    await openInviteForm();
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Role"), { target: { value: "student" } });
    expect(within(dialog.getByLabelText("Student")).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Select student", "Emmy Noether (M200)"]);

    fireEvent.change(dialog.getByLabelText("Role"), { target: { value: "director" } });
    expect(dialog.queryByLabelText("Student")).not.toBeInTheDocument();
    expect(dialog.queryByLabelText("Teacher")).not.toBeInTheDocument();
  });

  it("checks the form before sending it", async () => {
    renderPage();

    await openInviteForm();
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(screen.getByText("Email is required.")).toBeInTheDocument();
    expect(screen.getByText("Choose the teacher this account belongs to.")).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalledWith("/users", expect.objectContaining({ method: "POST" }));
  });

  it("shows the API's error in the form", async () => {
    mockApi({ "POST /users": () => Promise.reject(new Error("An account with this email already exists.")) });
    renderPage();

    await openInviteForm();
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Email"), { target: { value: "ada@unical.it" } });
    fireEvent.change(dialog.getByLabelText("Role"), { target: { value: "director" } });
    fireEvent.click(dialog.getByRole("button", { name: "Send invitation" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("An account with this email already exists.");
  });

  it("edits the role and linked record without sending the email", async () => {
    const updated = { ...ada, role: "student", teacher_id: null, student_id: 8, linked_name: "Emmy Noether (M200)" };
    mockApi({ "PATCH /users/u-ada": () => Promise.resolve(updated) });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit ada@unical.it" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(dialog.getByText("ada@unical.it")).toBeInTheDocument();
    fireEvent.change(dialog.getByLabelText("Role"), { target: { value: "student" } });
    fireEvent.change(dialog.getByLabelText("Student"), { target: { value: "8" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Account updated successfully.")).toBeInTheDocument();
    expect(sentBody("PATCH")).toEqual({ role: "student", teacher_id: null, student_id: 8 });
    expect(within(row("ada@unical.it")).getByText("Emmy Noether (M200)")).toBeInTheDocument();
  });

  it("does not let you change your own role", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit director@unical.it" }));

    expect(within(screen.getByRole("dialog")).getByLabelText("Role")).toBeDisabled();
  });

  it("deactivates an account after confirmation", async () => {
    mockApi({ "DELETE /users/u-ada": () => Promise.resolve(null) });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Deactivate ada@unical.it" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/will no longer be able to log in/)).toBeInTheDocument();
    expect(dialog.getByText(/The record of Ada Lovelace is kept/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Yes, deactivate" }));

    expect(await screen.findByText("ada@unical.it can no longer log in.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("rowheader", { name: /ada@unical.it/ })).not.toBeInTheDocument());
  });

  it("keeps the account when deactivation is cancelled", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Deactivate ada@unical.it" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("rowheader", { name: /ada@unical.it/ })).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalledWith("/users/u-ada", expect.objectContaining({ method: "DELETE" }));
  });

  it("filters by role and searches by name", async () => {
    renderPage();
    await screen.findByRole("rowheader", { name: /ada@unical.it/ });

    fireEvent.change(screen.getByLabelText("Filter by role"), { target: { value: "student" } });
    expect(screen.getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["grace@unical.it"]);

    fireEvent.change(screen.getByLabelText("Filter by role"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Search users"), { target: { value: "lovelace" } });
    expect(screen.getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["ada@unical.it"]);
  });

  it("explains when the accounts cannot be loaded", async () => {
    mockApi({ "GET /users": () => Promise.reject(new Error("User management is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env.")) });
    renderPage();

    expect(await screen.findByText(/User management is not configured/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite user" })).toBeDisabled();
  });
});
