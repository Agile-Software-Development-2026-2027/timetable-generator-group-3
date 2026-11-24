import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StudentTimetableContent from "../student-timetable-content.jsx";

const assigned = { id: 1, name: "Databases", is_extra: false };
const elective = { id: 2, name: "Statistics", is_extra: true };
const lesson = { id: 1, course_name: "Databases" };
const extraLesson = { id: 2, course_name: "Statistics" };

function makeData(overrides = {}) {
  return {
    courses: [assigned],
    availableCourses: [elective],
    sessions: [lesson],
    publication: { published: true },
    ...overrides,
  };
}

function Calendar({ sessions }) {
  return <section aria-label="Calendar">
    {sessions.map((row) => <p key={row.id}>{row.course_name} class</p>)}
  </section>;
}

function CoursesPanel({ courses, loading, onAdd, onRemove }) {
  return <section aria-label="Courses">
    {courses.map((course) => <p key={course.id}>{course.name}</p>)}
    <button disabled={loading} onClick={() => onAdd(2).catch(() => {})}>
      Add elective
    </button>
    <button disabled={loading} onClick={() => onRemove(2).catch(() => {})}>
      Remove elective
    </button>
  </section>;
}

function setup(overrides = {}) {
  const props = {
    Calendar,
    CoursesPanel,
    loadData: vi.fn().mockResolvedValue(makeData()),
    addCourse: vi.fn().mockResolvedValue(null),
    removeCourse: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  return { ...render(<StudentTimetableContent {...props} />), props };
}

describe("Student timetable content", () => {
  it("shows initial loading", () => {
    setup({ loadData: vi.fn(() => new Promise(() => {})) });
    expect(screen.getByText("Loading your timetable...")).toBeInTheDocument();
    expect(screen.queryByLabelText("Calendar")).not.toBeInTheDocument();
  });

  it("renders personal courses and sessions", async () => {
    const { props } = setup();
    expect(await screen.findByText("Databases class")).toBeInTheDocument();
    expect(screen.getByText("Databases")).toBeInTheDocument();
    expect(props.loadData).toHaveBeenCalledTimes(1);
  });

  it("shows unpublished timetable message", async () => {
    setup({ loadData: vi.fn().mockResolvedValue(makeData({
      sessions: [], publication: { published: false },
    })) });
    expect(await screen.findByText("No timetable published yet."))
      .toBeInTheDocument();
    expect(screen.queryByLabelText("Calendar")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Courses")).toBeInTheDocument();
  });

  it("distinguishes an empty published timetable", async () => {
    setup({ loadData: vi.fn().mockResolvedValue(makeData({ sessions: [] })) });
    expect(await screen.findByText(
      "No classes are currently scheduled for your courses."
    )).toBeInTheDocument();
    expect(screen.getByLabelText("Calendar")).toBeInTheDocument();
  });

  it("shows published electives before home degree publication", async () => {
    setup({ loadData: vi.fn().mockResolvedValue(makeData({
      courses: [assigned, elective], sessions: [extraLesson],
      publication: { published: false },
    })) });
    expect(await screen.findByText("Statistics class")).toBeInTheDocument();
    expect(screen.getByText("Your degree timetable is not published yet."))
      .toBeInTheDocument();
  });

  it("displays loading errors", async () => {
    setup({ loadData: vi.fn().mockRejectedValue(new Error("Network error")) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.queryByLabelText("Calendar")).not.toBeInTheDocument();
  });

  it("retries failed loading", async () => {
    const loadData = vi.fn().mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(makeData());
    setup({ loadData });
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Databases class")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(loadData).toHaveBeenCalledTimes(2);
  });

  it("refreshes after adding an elective", async () => {
    const loadData = vi.fn().mockResolvedValueOnce(makeData())
      .mockResolvedValueOnce(makeData({
        courses: [assigned, elective], sessions: [lesson, extraLesson],
      }));
    const { props } = setup({ loadData });
    fireEvent.click(await screen.findByRole("button", { name: "Add elective" }));
    expect(await screen.findByText("Statistics class")).toBeInTheDocument();
    expect(screen.getByText("Statistics")).toBeInTheDocument();
    expect(props.addCourse).toHaveBeenCalledTimes(1);
    expect(props.addCourse).toHaveBeenCalledWith(2);
    expect(loadData).toHaveBeenCalledTimes(2);
  });

  it("refreshes after removing an elective", async () => {
    const loadData = vi.fn().mockResolvedValueOnce(makeData({
      courses: [assigned, elective], sessions: [lesson, extraLesson],
    })).mockResolvedValueOnce(makeData());
    const { props } = setup({ loadData });
    await screen.findByText("Statistics class");
    fireEvent.click(screen.getByRole("button", { name: "Remove elective" }));
    await waitFor(() => {
      expect(screen.queryByText("Statistics class")).not.toBeInTheDocument();
      expect(screen.getByText("Databases class")).toBeInTheDocument();
    });
    expect(screen.queryByText("Statistics")).not.toBeInTheDocument();
    expect(props.removeCourse).toHaveBeenCalledTimes(1);
    expect(props.removeCourse).toHaveBeenCalledWith(2);
    expect(loadData).toHaveBeenCalledTimes(2);
  });

  it("preserves data when enrollment fails", async () => {
    const { props } = setup({
      addCourse: vi.fn().mockRejectedValue(new Error("Already enrolled")),
    });
    const button = await screen.findByRole("button", { name: "Add elective" });
    await act(async () => { fireEvent.click(button); });
    expect(props.addCourse).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Databases class")).toBeInTheDocument();
    expect(props.loadData).toHaveBeenCalledTimes(1);
  });

  it("prevents concurrent enrollment operations", async () => {
    let complete;
    const addCourse = vi.fn(() => new Promise((resolve) => {
      complete = resolve;
    }));
    const { props } = setup({ addCourse });
    const button = await screen.findByRole("button", { name: "Add elective" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Remove elective" }));
    expect(addCourse).toHaveBeenCalledTimes(1);
    expect(props.removeCourse).not.toHaveBeenCalled();
    await act(async () => { complete(); });
    expect(props.loadData).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Databases class")).toBeInTheDocument();
  });

  it("reports a refresh failure after enrollment", async () => {
    const loadData = vi.fn().mockResolvedValueOnce(makeData())
      .mockRejectedValueOnce(new Error("Refresh failed"));
    const { props } = setup({ loadData });
    fireEvent.click(await screen.findByRole("button", { name: "Add elective" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Courses updated, but the timetable could not be refreshed."
    );
    expect(props.addCourse).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Calendar")).not.toBeInTheDocument();
  });

  it("ignores stale initial loading results", async () => {
    let complete;
    const loadData = vi.fn(() => new Promise((resolve) => {
      complete = resolve;
    }));
    const { props, rerender } = setup({ loadData });
    rerender(<StudentTimetableContent {...props}
      loadData={vi.fn().mockResolvedValue(makeData({ sessions: [extraLesson] }))}
    />);
    await screen.findByText("Statistics class");
    await act(async () => { complete(makeData()); });
    expect(screen.getByText("Statistics class")).toBeInTheDocument();
    expect(screen.queryByText("Databases class")).not.toBeInTheDocument();
  });
});
