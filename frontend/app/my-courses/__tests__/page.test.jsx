import {
  cleanup, fireEvent, render, screen, waitFor,
} from "@testing-library/react";
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from "vitest";
import { AuthContext } from "../../components/auth-provider.jsx";
import MyCoursesPage from "../page.jsx";
import {
  fetchStudentCourses,
  fetchAvailableCourses,
  addExtraCourse,
  removeExtraCourse,
} from "../../../lib/student-api.js";

vi.mock("../../components/app-shell.jsx", () => ({
  AppNav: ({ current }) => (
    <nav aria-label="Application navigation">{current}</nav>
  ),
}));

vi.mock("../../../lib/student-api.js", () => ({
  fetchStudentCourses: vi.fn(),
  fetchAvailableCourses: vi.fn(),
  addExtraCourse: vi.fn(),
  removeExtraCourse: vi.fn(),
}));

const studentAuth = {
  status: "signed-in",
  role: "student",
  me: { id: "student-account-a", role: "student" },
};

const assigned = {
  id: 1, name: "Databases", is_extra: false,
};

const elective = {
  id: 2, name: "Statistics",
};

function setup(auth = studentAuth) {
  return render(
    <AuthContext.Provider value={auth}>
      <MyCoursesPage />
    </AuthContext.Provider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  fetchStudentCourses.mockResolvedValue([assigned]);
  fetchAvailableCourses.mockResolvedValue([elective]);
  addExtraCourse.mockResolvedValue(null);
  removeExtraCourse.mockResolvedValue(null);
});

afterEach(cleanup);

describe("My courses page", () => {
  it("loads personal and available courses", async () => {
    setup();

    expect(screen.getByRole("heading", { name: "My courses" }))
      .toBeInTheDocument();

    expect(await screen.findByText("Databases"))
      .toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Add Statistics" }))
      .toBeEnabled();

    expect(screen.queryByLabelText("Personal weekly timetable"))
      .not.toBeInTheDocument();
  });

  it("adds an extra course and refreshes both course lists", async () => {
    fetchStudentCourses.mockResolvedValueOnce([assigned])
      .mockResolvedValueOnce([
        assigned, { ...elective, is_extra: true },
      ]);

    fetchAvailableCourses.mockResolvedValueOnce([elective])
      .mockResolvedValueOnce([]);

    setup();

    fireEvent.click(await screen.findByRole("button", {
      name: "Add Statistics",
    }));

    expect(await screen.findByRole("button", {
      name: "Remove Statistics",
    })).toBeInTheDocument();

    expect(addExtraCourse).toHaveBeenCalledWith(2);
    expect(fetchStudentCourses).toHaveBeenCalledTimes(2);
    expect(fetchAvailableCourses).toHaveBeenCalledTimes(2);
  });

  it("removes an extra course and refreshes both course lists", async () => {
    fetchStudentCourses.mockResolvedValueOnce([
      assigned, { ...elective, is_extra: true },
    ]).mockResolvedValueOnce([assigned]);

    fetchAvailableCourses.mockResolvedValueOnce([])
      .mockResolvedValueOnce([elective]);

    setup();

    fireEvent.click(await screen.findByRole("button", {
      name: "Remove Statistics",
    }));

    expect(await screen.findByRole("button", {
      name: "Add Statistics",
    })).toBeInTheDocument();

    expect(removeExtraCourse).toHaveBeenCalledWith(2);
    expect(fetchStudentCourses).toHaveBeenCalledTimes(2);
    expect(fetchAvailableCourses).toHaveBeenCalledTimes(2);
  });

  it.each(["teacher", "director"])(
    "does not load Student data for a %s",
    (role) => {
      setup({
        status: "signed-in",
        role,
        me: { id: "other-account", role },
      });

      expect(fetchStudentCourses).not.toHaveBeenCalled();
      expect(fetchAvailableCourses).not.toHaveBeenCalled();
    }
  );

  it.each(["loading", "signed-out"])(
    "does not load Student data while %s",
    (status) => {
      setup({ status });

      expect(fetchStudentCourses).not.toHaveBeenCalled();
      expect(fetchAvailableCourses).not.toHaveBeenCalled();
    }
  );

  it("requires a verified account identity", () => {
    setup({ status: "signed-in", role: "student", me: {} });
    expect(fetchStudentCourses).not.toHaveBeenCalled();
  });

  it("allows retry after a loading failure", async () => {
    fetchStudentCourses.mockRejectedValueOnce(
      new Error("Network error")
    );

    setup();

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Network error");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByText("Databases")).toBeInTheDocument();
    });
  });
});
