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
  it("opens course editing in the styled dialog", async () => {
    mockApi([rossi, bianchi]);
    render(<CoursesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit Databases" }));

    expect(await screen.findByRole("dialog", { name: "Edit course" })).toBeInTheDocument();
    expect(screen.getByLabelText("Course name")).toHaveValue("Databases");
  });

  it("shows a prominent success popup after updating a course", async () => {
    mockApi([rossi, bianchi]);
    render(<CoursesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit Databases" }));
    const nameInput = await screen.findByLabelText("Course name");
    fireEvent.change(nameInput, { target: { value: "Updated Databases" } });
    fireEvent.submit(nameInput.closest("form"));

    const notification = (await screen.findByText("Course updated successfully.")).closest("[role='status']");
    expect(notification).toHaveClass("app-notification-success-prominent");
  });

  it("asks for confirmation before deleting a course", async () => {
    mockApi([rossi, bianchi]);
    render(<CoursesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete Databases" }));
    expect(await screen.findByRole("dialog", { name: "Delete course?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "No, keep it" }));

    expect(calls("DELETE")).toHaveLength(0);
  });

  it("asks for explicit confirmation before deleting saved timetable sessions", async () => {
    global.fetch = vi.fn((url, options) => {
      if (options?.method === "DELETE" && !url.includes("force=true")) {
        return jsonResponse({
          detail: "This course is used in 2 saved timetable session(s). Confirm to delete it anyway.",
        }, false, 409);
      }
      if (options?.method === "DELETE") {
        return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) });
      }
      if (options?.method === "PUT") return jsonResponse({});
      if (url.includes("/teachers")) return jsonResponse([rossi, bianchi]);
      if (url.includes("/courses")) return jsonResponse(courses);
      if (url.endsWith("/degrees")) return jsonResponse([]);
      return jsonResponse({});
    });
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<CoursesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete Databases" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    expect(await screen.findByText(/used in 2 saved timetable session/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete course and sessions" }));

    await waitFor(() => expect(calls("DELETE")).toHaveLength(2));
    expect(calls("DELETE")[1][0]).toMatch(/\/courses\/10\?force=true$/);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("uses the shared course catalogue layout and filters visible courses", async () => {
    mockApi([rossi, bianchi]);
    render(<CoursesPage />);

    expect(await screen.findByRole("heading", { name: "Courses", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Course catalogue" })).toBeInTheDocument();
    expect(screen.getByText("Databases")).toBeInTheDocument();
    expect(screen.getByText("Algorithms")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Databases" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Databases" }).querySelector("svg")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search courses or degrees" }), {
      target: { value: "algo" },
    });

    expect(screen.queryByText("Databases")).not.toBeInTheDocument();
    expect(screen.getByText("Algorithms")).toBeInTheDocument();
  });

  it("changes the course page size using the rows dropdown", async () => {
    const manyCourses = Array.from({ length: 11 }, (_, index) => course(index + 1, `Course ${index + 1}`));
    global.fetch = vi.fn((url) => {
      if (url.includes("/teachers")) return jsonResponse([]);
      if (url.includes("/courses")) return jsonResponse(manyCourses);
      if (url.endsWith("/degrees")) return jsonResponse([]);
      return jsonResponse({});
    });
    render(<CoursesPage />);

    expect(await screen.findByText("Showing 1–10 of 11 courses")).toBeInTheDocument();
    expect(screen.queryByText("Course 11")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "50" } });

    expect(screen.getByText("Course 1")).toBeInTheDocument();
    expect(screen.getByText("Course 11")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1–11 of 11 courses");
  });

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
