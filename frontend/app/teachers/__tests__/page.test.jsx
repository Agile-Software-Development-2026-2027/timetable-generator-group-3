import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import TeachersPage from "../page.jsx";

const courses = [{ id: 10, name: "Databases", degree: "Computer Science" }, { id: 11, name: "Algorithms", degree: "Computer Science" }];
const rossi = { id: 1, name: "Mario Rossi", identifier: "m.rossi@unical.it", course_count: 1, courses: [courses[0]] };
const bianchi = { id: 2, name: "Anna Bianchi", identifier: "STAFF-042", course_count: 0, courses: [] };

function jsonResponse(data, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(data) });
}

function mockApi(teachers, handler = () => undefined) {
  global.fetch = vi.fn((url, options) => handler(url, options)
    ?? jsonResponse(url.endsWith("/courses") ? courses : teachers));
}

const calls = (method) => global.fetch.mock.calls.filter(([, options]) => options?.method === method);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TeachersPage", () => {
  it("lists teachers with identifier and course count, and shows their courses", async () => {
    mockApi([rossi, bianchi]);
    render(<TeachersPage />);

    const row = (await screen.findByRole("rowheader", { name: "Mario Rossi" })).closest("tr");
    expect(within(row).getByText("m.rossi@unical.it")).toBeInTheDocument();
    expect(within(row).getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2 total")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View courses of Mario Rossi" }));
    expect(within(screen.getByRole("dialog")).getByText("Databases")).toBeInTheDocument();
  });

  it("shows ten teachers per page and lets the user navigate to the next page", async () => {
    const teachers = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1,
      name: `Teacher ${index + 1}`,
      identifier: `STAFF-${index + 1}`,
      course_count: 0,
      courses: [],
    }));
    mockApi(teachers);
    render(<TeachersPage />);

    expect(await screen.findByRole("rowheader", { name: "Teacher 1" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Teacher 10" })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: "Teacher 11" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("rowheader", { name: "Teacher 11" })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: "Teacher 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 11–11 of 11 teachers");
  });

  it("creates a teacher assigned to the selected courses", async () => {
    mockApi([], (url, options) => (options?.method === "POST" ? jsonResponse({}, true, 201) : undefined));
    render(<TeachersPage />);
    await screen.findByText("No teachers yet");

    fireEvent.click(screen.getByRole("button", { name: "Create teacher" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: " Mario Rossi " } });
    fireEvent.change(screen.getByLabelText("Identifier (staff code or email)"), { target: { value: "STAFF-1" } });
    fireEvent.click(screen.getByLabelText(/Algorithms/));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create teacher" }));

    await waitFor(() => expect(calls("POST")).toHaveLength(1));
    expect(JSON.parse(calls("POST")[0][1].body)).toEqual({ name: "Mario Rossi", identifier: "STAFF-1", course_ids: [11] });
  });

  it("rejects a duplicate identifier with a clear message", async () => {
    mockApi([rossi]);
    render(<TeachersPage />);
    await screen.findByRole("rowheader", { name: "Mario Rossi" });

    fireEvent.click(screen.getByRole("button", { name: "Create teacher" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Someone" } });
    fireEvent.change(screen.getByLabelText("Identifier (staff code or email)"), { target: { value: "M.Rossi@unical.it" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create teacher" }));

    expect(screen.getByText("A teacher with the identifier 'M.Rossi@unical.it' already exists.")).toBeInTheDocument();
    expect(calls("POST")).toHaveLength(0);
  });

  it("shows the API error when the server rejects the teacher", async () => {
    mockApi([], (url, options) => (options?.method === "POST" ? jsonResponse({ detail: "A teacher with the identifier 'X' already exists." }, false, 409) : undefined));
    render(<TeachersPage />);
    await screen.findByText("No teachers yet");

    fireEvent.click(screen.getByRole("button", { name: "Create teacher" }));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Identifier (staff code or email)"), { target: { value: "X" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create teacher" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });

  it("edits a teacher and changes their courses", async () => {
    mockApi([rossi], (url, options) => (options?.method === "PUT" ? jsonResponse(rossi) : undefined));
    render(<TeachersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Mario Rossi" }));

    expect(screen.getByLabelText(/Databases/)).toBeChecked();
    fireEvent.click(screen.getByLabelText(/Databases/));
    fireEvent.click(screen.getByLabelText(/Algorithms/));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(calls("PUT")).toHaveLength(1));
    expect(calls("PUT")[0][0]).toMatch(/\/teachers\/1$/);
    expect(JSON.parse(calls("PUT")[0][1].body).course_ids).toEqual([11]);
  });

  it("warns before deleting an assigned teacher and removes the assignments on confirm", async () => {
    mockApi([rossi], (url, options) => (options?.method === "DELETE" ? jsonResponse(null, true, 204) : undefined));
    render(<TeachersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Mario Rossi" }));

    expect(screen.getByRole("alert")).toHaveTextContent("assigned to 1 course (Databases)");
    expect(screen.getByRole("button", { name: "Unassign courses" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove assignments and delete" }));

    await waitFor(() => expect(calls("DELETE")).toHaveLength(1));
    expect(calls("DELETE")[0][0]).toMatch(/\/teachers\/1\?force=true$/);
  });

  it("deletes an unassigned teacher without forcing", async () => {
    mockApi([bianchi], (url, options) => (options?.method === "DELETE" ? jsonResponse(null, true, 204) : undefined));
    render(<TeachersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Anna Bianchi" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(calls("DELETE")).toHaveLength(1));
    expect(calls("DELETE")[0][0]).toMatch(/\/teachers\/2$/);
  });
});
