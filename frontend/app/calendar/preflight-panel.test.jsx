import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import {
  PreflightPanel,
  groupPreflightWarnings,
  preflightWarningLink,
} from "./preflight-panel.jsx";

afterEach(cleanup);

const missingTeacher = {
  type: "missing_teacher",
  severity: "warning",
  message: "Databases: No teacher is assigned.",
  course_id: 12,
};

const roomCapacity = {
  type: "room_capacity",
  severity: "error",
  message: "Algorithms: No room fits 150 students.",
  course_id: 15,
};

const teacherWorkload = {
  type: "teacher_workload",
  severity: "error",
  message: "Teacher workload exceeds configured limits.",
  teacher_id: 5,
};

const warnings = [
  missingTeacher,
  roomCapacity,
  teacherWorkload,
];

function openPanel() {
  const button = screen.getByRole("button", {
    name: /Pre-generation warnings/,
  });

  fireEvent.click(button);

  return screen.getByRole("region", {
    name: "Pre-generation warnings",
  });
}

describe("KAN-67 preflight panel", () => {
  it("does not display a badge for a clean dataset", () => {
    render(<PreflightPanel warnings={[]} />);

    expect(
      screen.queryByRole("button", {
        name: /Pre-generation warnings/,
      })
    ).toBeNull();
  });

  it("displays the correct warning count", () => {
    render(<PreflightPanel warnings={warnings} />);

    const button = screen.getByRole("button", {
      name: /Pre-generation warnings/,
    });

    expect(button).toHaveTextContent("3");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("opens and closes the warnings panel", () => {
    render(<PreflightPanel warnings={warnings} />);

    expect(
      screen.queryByRole("region", {
        name: "Pre-generation warnings",
      })
    ).toBeNull();

    const panel = openPanel();

    expect(panel).toBeVisible();

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Close pre-generation warnings",
      })
    );

    expect(
      screen.queryByRole("region", {
        name: "Pre-generation warnings",
      })
    ).toBeNull();
  });

  it("groups warnings by type", () => {
    const groups = groupPreflightWarnings([
      missingTeacher,
      roomCapacity,
      {
        ...missingTeacher,
        course_id: 13,
        message: "Networks: No teacher is assigned.",
      },
    ]);

    expect(groups).toHaveLength(2);

    expect(groups[0].type).toBe("missing_teacher");
    expect(groups[0].warnings).toHaveLength(2);

    expect(groups[1].type).toBe("room_capacity");
    expect(groups[1].warnings).toHaveLength(1);
  });

  it("renders warning group headings", () => {
    render(<PreflightPanel warnings={warnings} />);

    const panel = openPanel();

    expect(
      within(panel).getByRole("heading", {
        name: "Missing teacher (1)",
      })
    ).toBeVisible();

    expect(
      within(panel).getByRole("heading", {
        name: "Room capacity (1)",
      })
    ).toBeVisible();

    expect(
      within(panel).getByRole("heading", {
        name: "Teacher workload (1)",
      })
    ).toBeVisible();
  });

  it("displays separate error and warning counts", () => {
    render(<PreflightPanel warnings={warnings} />);

    const panel = openPanel();

    expect(within(panel).getByText("2 errors")).toBeVisible();
    expect(within(panel).getByText("1 warning")).toBeVisible();
  });

  it("links missing teachers to the course assignment form", () => {
    render(<PreflightPanel warnings={[missingTeacher]} />);

    const panel = openPanel();

    expect(
      within(panel).getByRole("link", {
        name: "Assign teachers",
      })
    ).toHaveAttribute("href", "/courses?assign=12");
  });

  it("links course problems to the correct editing form", () => {
    render(<PreflightPanel warnings={[roomCapacity]} />);

    const panel = openPanel();

    expect(
      within(panel).getByRole("link", {
        name: "Edit course",
      })
    ).toHaveAttribute("href", "/courses?edit=15");
  });

  it("links teacher problems to the correct teacher", () => {
    render(<PreflightPanel warnings={[teacherWorkload]} />);

    const panel = openPanel();

    expect(
      within(panel).getByRole("link", {
        name: "Edit workload preferences",
      })
    ).toHaveAttribute("href", "/teachers?workload=5");
  });

  it("links availability warnings to the availability editor", () => {
    render(<PreflightPanel warnings={[{
      type: "teacher_unavailable",
      severity: "error",
      message: "Teacher has no available teaching slots.",
      teacher_id: 5,
    }]} />);

    const panel = openPanel();

    expect(
      within(panel).getByRole("link", {
        name: "Edit teacher availability",
      })
    ).toHaveAttribute("href", "/teachers?availability=5");
  });

  it("does not create links without valid record IDs", () => {
    expect(
      preflightWarningLink({
        type: "teacher_workload",
        severity: "error",
        message: "Unknown teacher.",
      })
    ).toBeNull();

    expect(
      preflightWarningLink({
        ...missingTeacher,
        course_id: -1,
      })
    ).toBeNull();
  });

  it("preserves the expanded panel when warnings refresh", () => {
    const { rerender } = render(
      <PreflightPanel warnings={[missingTeacher]} />
    );

    openPanel();

    rerender(<PreflightPanel warnings={warnings} />);

    expect(
      screen.getByRole("region", {
        name: "Pre-generation warnings",
      })
    ).toBeVisible();

    expect(screen.getByText("2 errors")).toBeVisible();
  });

  it("supports warning types without predefined labels", () => {
    const groups = groupPreflightWarnings([
      {
        type: "future_constraint",
        severity: "warning",
        message: "Additional constraint.",
      },
    ]);

    expect(groups[0].label).toBe("future constraint");
  });
});
