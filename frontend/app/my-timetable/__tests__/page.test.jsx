import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../../components/auth-provider.jsx";
import MyTimetablePage from "../page.jsx";

import {
  fetchStudentTimetableData,
  addExtraCourse,
  removeExtraCourse,
} from "../../../lib/student-api.js";

vi.mock("../../components/app-shell.jsx", () => ({
  AppNav: ({ current }) => (
    <nav aria-label="Application navigation">{current}</nav>
  ),
}));

vi.mock("../../../lib/student-api.js", () => ({
  fetchStudentTimetableData: vi.fn(),
  addExtraCourse: vi.fn(),
  removeExtraCourse: vi.fn(),
}));

vi.mock("../student-calendar.jsx", () => ({
  default: ({ sessions }) => (
    <section aria-label="Personal weekly timetable">
      {sessions.map((session) => (
        <p key={session.id}>{session.course_name} class</p>
      ))}
    </section>
  ),
}));

const studentAuth = {
  status: "signed-in",
  role: "student",
  me: { id: "student-account-a", role: "student" },
};

const data = {
  courses: [{ id: 1, name: "Databases", is_extra: false }],
  availableCourses: [{ id: 2, name: "Statistics" }],
  sessions: [{ id: 1, course_name: "Databases" }],
  publication: { published: true },
};

function setup(auth = studentAuth) {
  return render(
    <AuthContext.Provider value={auth}>
      <MyTimetablePage />
    </AuthContext.Provider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  fetchStudentTimetableData.mockResolvedValue(data);
  addExtraCourse.mockResolvedValue(null);
  removeExtraCourse.mockResolvedValue(null);
});

afterEach(cleanup);

describe("My timetable page", () => {
  it("displays only the personal weekly timetable", async () => {
    setup();

    expect(screen.getByRole("heading", {
      name: "My timetable",
    })).toBeInTheDocument();

    expect(await screen.findByText("Databases class")).toBeInTheDocument();

    expect(screen.queryByRole("heading", {
      name: "Your courses",
    })).not.toBeInTheDocument();

    expect(screen.queryByRole("button", {
      name: "Add Statistics",
    })).not.toBeInTheDocument();

    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(fetchStudentTimetableData).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
  });

  it("uses the KAN-75 calendar page layout", async () => {
    const { container } = setup();

    await screen.findByText("Databases class");

    expect(container.querySelector(".campus-app.calendar-page"))
      .not.toBeNull();

    expect(container.querySelector(".room-table-panel"))
      .not.toBeNull();

    expect(screen.getByRole("navigation", {
      name: "Application navigation",
    })).toHaveTextContent("/my-timetable");
  });

  it("does not request personal data while authentication is loading", () => {
    setup({ status: "loading" });

    expect(screen.getByRole("status"))
      .toHaveTextContent("Checking your session");

    expect(fetchStudentTimetableData).not.toHaveBeenCalled();
  });

  it.each(["teacher", "director"])(
    "does not request Student data for a %s account",
    (role) => {
      setup({
        status: "signed-in",
        role,
        me: { id: "other-account", role },
      });

      expect(fetchStudentTimetableData).not.toHaveBeenCalled();
      expect(screen.queryByRole("heading", {
        name: "My courses",
      })).not.toBeInTheDocument();
    }
  );

  it("does not request personal data for a signed-out user", () => {
    setup({ status: "signed-out" });

    expect(fetchStudentTimetableData).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Personal weekly timetable"))
      .not.toBeInTheDocument();
  });

  it("requires a verified account identity before loading data", () => {
    setup({
      status: "signed-in",
      role: "student",
      me: {},
    });

    expect(fetchStudentTimetableData).not.toHaveBeenCalled();
    expect(screen.getByRole("status"))
      .toHaveTextContent("A valid student account is required");
  });

  it("renders an error when personal data is unavailable", async () => {
    fetchStudentTimetableData.mockRejectedValue(
      new Error("Student account linking is not available yet.")
    );

    setup();

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Student account linking is not available yet.");

    expect(screen.getByRole("button", {
      name: "Retry",
    })).toBeEnabled();

    expect(screen.queryByLabelText("Personal weekly timetable"))
      .not.toBeInTheDocument();
  });
});
