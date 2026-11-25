import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../../components/auth-provider.jsx";
import MyTimetablePage from "../page.jsx";
import { createStudentAccountRequest } from "../../../lib/student-account-request.js";

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

vi.mock("../../../lib/student-account-request.js", () => ({
  createStudentAccountRequest: vi.fn(),
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

const accountRequest = vi.fn();

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
  createStudentAccountRequest.mockReturnValue(accountRequest);
  fetchStudentTimetableData.mockResolvedValue(data);
  addExtraCourse.mockResolvedValue(null);
  removeExtraCourse.mockResolvedValue(null);
});

afterEach(cleanup);

describe("My timetable page", () => {
  it("replaces the previous student's courses when accounts change", async () => {
    const secondAuth = {
      status: "signed-in",
      role: "student",
      me: { id: "student-account-b", role: "student" },
    };

    const secondRequest = vi.fn();

    const secondData = {
      courses: [{ id: 8, name: "Physics", is_extra: false }],
      availableCourses: [],
      sessions: [{ id: 8, course_name: "Physics" }],
      publication: { published: true },
    };

    createStudentAccountRequest.mockImplementation((id) =>
      id === "student-account-a" ? accountRequest : secondRequest
    );

    fetchStudentTimetableData.mockImplementation(async (request) =>
      request === accountRequest ? data : secondData
    );

    const { rerender } = setup();

    await screen.findByText("Databases class");

    rerender(
      <AuthContext.Provider value={secondAuth}>
        <MyTimetablePage />
      </AuthContext.Provider>
    );

    expect(screen.queryByText("Databases class"))
      .not.toBeInTheDocument();

    expect(await screen.findByText("Physics class"))
      .toBeInTheDocument();

    expect(screen.getByText("Physics")).toBeInTheDocument();
    expect(screen.queryByText("Databases")).not.toBeInTheDocument();

    expect(createStudentAccountRequest)
      .toHaveBeenLastCalledWith("student-account-b");

    expect(fetchStudentTimetableData)
      .toHaveBeenLastCalledWith(secondRequest);
  });

  it("ignores late timetable responses from a previous account", async () => {
    let completeFirst;

    const secondAuth = {
      ...studentAuth,
      me: { id: "student-account-b", role: "student" },
    };

    const secondRequest = vi.fn();

    createStudentAccountRequest.mockImplementation((id) =>
      id === "student-account-a" ? accountRequest : secondRequest
    );

    fetchStudentTimetableData.mockImplementation((request) => {
      if (request === accountRequest) {
        return new Promise((resolve) => {
          completeFirst = resolve;
        });
      }

      return Promise.resolve({
        courses: [{ id: 8, name: "Physics", is_extra: false }],
        availableCourses: [],
        sessions: [{ id: 8, course_name: "Physics" }],
        publication: { published: true },
      });
    });

    const { rerender } = setup();

    await waitFor(() => {
      expect(fetchStudentTimetableData)
        .toHaveBeenCalledWith(accountRequest);
    });

    rerender(
      <AuthContext.Provider value={secondAuth}>
        <MyTimetablePage />
      </AuthContext.Provider>
    );

    await screen.findByText("Physics class");

    await act(async () => {
      completeFirst(data);
    });

    expect(screen.getByText("Physics class"))
      .toBeInTheDocument();

    expect(screen.queryByText("Databases class"))
      .not.toBeInTheDocument();

    expect(screen.queryByText("Databases"))
      .not.toBeInTheDocument();
  });

  it("removes all personal content when a student signs out", async () => {
    const { rerender } = setup();

    await screen.findByText("Databases class");

    rerender(
      <AuthContext.Provider value={{ status: "signed-out" }}>
        <MyTimetablePage />
      </AuthContext.Provider>
    );

    expect(screen.queryByText("Databases class"))
      .not.toBeInTheDocument();

    expect(screen.queryByRole("heading", {
      name: "My courses",
    })).not.toBeInTheDocument();

    expect(fetchStudentTimetableData).toHaveBeenCalledTimes(1);
  });

  it("hides personal content during account verification", async () => {
    const { rerender } = setup();

    await screen.findByText("Databases class");

    rerender(
      <AuthContext.Provider value={{ status: "loading" }}>
        <MyTimetablePage />
      </AuthContext.Provider>
    );

    expect(screen.getByRole("status"))
      .toHaveTextContent("Checking your session");

    expect(screen.queryByText("Databases class"))
      .not.toBeInTheDocument();

    expect(screen.queryByRole("heading", {
      name: "My courses",
    })).not.toBeInTheDocument();
  });

  it("does not refresh a previous account after pending enrollment", async () => {
    let completeEnrollment;

    const secondAuth = {
      ...studentAuth,
      me: { id: "student-account-b", role: "student" },
    };

    const secondRequest = vi.fn();

    createStudentAccountRequest.mockImplementation((id) =>
      id === "student-account-a" ? accountRequest : secondRequest
    );

    fetchStudentTimetableData.mockImplementation(async (request) => {
      if (request === accountRequest) return data;

      return {
        courses: [{ id: 8, name: "Physics", is_extra: false }],
        availableCourses: [],
        sessions: [{ id: 8, course_name: "Physics" }],
        publication: { published: true },
      };
    });

    addExtraCourse.mockImplementation(() => new Promise((resolve) => {
      completeEnrollment = resolve;
    }));

    const { rerender } = setup();

    await screen.findByText("Databases class");

    fireEvent.change(screen.getByLabelText("Add an extra course"), {
      target: { value: "2" },
    });

    fireEvent.click(screen.getByRole("button", {
      name: "Add course",
    }));

    await waitFor(() => {
      expect(addExtraCourse).toHaveBeenCalledWith(2, accountRequest);
    });

    rerender(
      <AuthContext.Provider value={secondAuth}>
        <MyTimetablePage />
      </AuthContext.Provider>
    );

    await screen.findByText("Physics class");

    await act(async () => {
      completeEnrollment(null);
    });

    expect(fetchStudentTimetableData).toHaveBeenCalledTimes(2);

    expect(fetchStudentTimetableData)
      .toHaveBeenNthCalledWith(1, accountRequest);

    expect(fetchStudentTimetableData)
      .toHaveBeenNthCalledWith(2, secondRequest);

    expect(screen.getByText("Physics class"))
      .toBeInTheDocument();

    expect(screen.queryByText("Databases class"))
      .not.toBeInTheDocument();
  });

  it("preserves stable requests when the same account rerenders", async () => {
    const { rerender } = setup();

    await screen.findByText("Databases class");

    rerender(
      <AuthContext.Provider value={{
        ...studentAuth,
        me: { ...studentAuth.me },
      }}>
        <MyTimetablePage />
      </AuthContext.Provider>
    );

    expect(screen.getByText("Databases class"))
      .toBeInTheDocument();

    expect(createStudentAccountRequest).toHaveBeenCalledTimes(1);

    expect(fetchStudentTimetableData).toHaveBeenCalledTimes(1);
  });


  it("binds timetable loading to the authenticated account", async () => {
    setup();

    await screen.findByText("Databases class");

    expect(createStudentAccountRequest).toHaveBeenCalledWith(
      "student-account-a"
    );

    expect(fetchStudentTimetableData).toHaveBeenCalledWith(accountRequest);
  });

  it("uses account-bound requests when adding an elective", async () => {
    setup();

    await screen.findByText("Databases class");

    fireEvent.change(screen.getByLabelText("Add an extra course"), {
      target: { value: "2" },
    });

    fireEvent.click(screen.getByRole("button", {
      name: "Add course",
    }));

    await waitFor(() => {
      expect(addExtraCourse).toHaveBeenCalledWith(2, accountRequest);
    });

    await waitFor(() => {
      expect(fetchStudentTimetableData).toHaveBeenCalledTimes(2);
    });

    expect(fetchStudentTimetableData).toHaveBeenLastCalledWith(
      accountRequest
    );

    await screen.findByText("Databases class");
  });

  it("uses account-bound requests when removing an elective", async () => {
    fetchStudentTimetableData.mockResolvedValue({
      ...data,
      courses: [
        ...data.courses,
        { id: 2, name: "Statistics", is_extra: true },
      ],
    });

    setup();

    fireEvent.click(await screen.findByRole("button", {
      name: "Remove Statistics",
    }));

    await waitFor(() => {
      expect(removeExtraCourse).toHaveBeenCalledWith(2, accountRequest);
    });

    await waitFor(() => {
      expect(fetchStudentTimetableData).toHaveBeenCalledTimes(2);
    });

    expect(fetchStudentTimetableData).toHaveBeenLastCalledWith(
      accountRequest
    );

    await screen.findByText("Databases class");
  });

  it("does not create account-bound requests for signed-out users", () => {
    setup({ status: "signed-out" });

    expect(createStudentAccountRequest).not.toHaveBeenCalled();
    expect(fetchStudentTimetableData).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only account identities", () => {
    setup({
      status: "signed-in",
      role: "student",
      me: { id: " " },
    });

    expect(createStudentAccountRequest).not.toHaveBeenCalled();
    expect(fetchStudentTimetableData).not.toHaveBeenCalled();
  });


  it("connects personal courses and the weekly timetable", async () => {
    setup();

    expect(screen.getByRole("heading", {
      name: "My timetable",
    })).toBeInTheDocument();

    expect(await screen.findByText("Databases class")).toBeInTheDocument();

    expect(screen.getByRole("heading", {
      name: "My courses",
    })).toBeInTheDocument();

    expect(screen.getByText("Databases")).toBeInTheDocument();
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
