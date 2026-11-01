import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import CoursesPage from "../page.jsx";

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

describe("CoursesPage", () => {
  it("shows each course with its teachers and saves new assignments", async () => {
    mockApi([rossi, bianchi], (url, options) => (options?.method === "PUT" ? jsonResponse({}) : undefined));
    render(<CoursesPage />);

    const row = (await screen.findByRole("rowheader", { name: "Databases" })).closest("tr");
    expect(within(row).getByText("Mario Rossi")).toBeInTheDocument();
    const other = screen.getByRole("rowheader", { name: "Algorithms" }).closest("tr");
    expect(within(other).getByText("No teacher assigned")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Assign teachers to Databases" }));
    expect(screen.getByLabelText(/Mario Rossi/)).toBeChecked();
    fireEvent.click(screen.getByLabelText(/Anna Bianchi/));
    fireEvent.click(screen.getByRole("button", { name: "Save assignments" }));

    await waitFor(() => expect(calls("PUT")).toHaveLength(1));
    expect(calls("PUT")[0][0]).toMatch(/\/courses\/10\/teachers$/);
    expect(JSON.parse(calls("PUT")[0][1].body)).toEqual({ teacher_ids: [1, 2] });
  });

  it("shows a message when no teacher is registered yet", async () => {
    mockApi([]);
    render(<CoursesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Assign teachers to Databases" }));
    expect(screen.getByText(/No teachers registered yet/)).toBeInTheDocument();
  });
});
