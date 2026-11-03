import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import CoursesPage from "../page.jsx";

const course = (id, name) => ({
  id, name, degree_id: 1, degree: "Computer Science", year_id: 1, year: 1, semester_id: 1, semester: 1,
  weekly_hours: 4, enrolled_students: 80, requires_lab: false, requires_projector: false,
});
const courses = [course(10, "Databases"), course(11, "Algorithms")];
const rossi = { id: 1, name: "Mario Rossi", identifier: "m.rossi@unical.it", course_count: 1, courses: [{ id: 10, name: "Databases", degree: "Computer Science" }] };
const bianchi = { id: 2, name: "Anna Bianchi", identifier: "STAFF-042", course_count: 0, courses: [] };

function jsonResponse(data, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(data) });
}

function mockApi(teachers) {
  global.fetch = vi.fn((url, options) => {
    if (options?.method === "PUT") return jsonResponse({});
    if (url.includes("/teachers")) return jsonResponse(teachers);
    if (url.includes("/courses")) return jsonResponse(courses);
    if (url.endsWith("/degrees")) return jsonResponse([]);
    return jsonResponse({});
  });
}

const calls = (method) => global.fetch.mock.calls.filter(([, options]) => options?.method === method);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CoursesPage teacher assignments", () => {
  it("shows the teachers of each course and saves new assignments", async () => {
    mockApi([rossi, bianchi]);
    render(<CoursesPage />);

    const row = (await screen.findByText("Databases")).closest("tr");
    expect(within(row).getByText("Mario Rossi")).toBeInTheDocument();
    const other = screen.getByText("Algorithms").closest("tr");
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
