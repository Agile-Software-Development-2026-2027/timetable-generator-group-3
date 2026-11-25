import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MyCoursesPanel from "../my-courses-panel.jsx";

const assigned = { id: 1, name: "Databases", is_extra: false };
const extra = { id: 2, name: "Statistics", is_extra: true };
const elective = { id: 3, name: "Computer Networks" };

const courses = [assigned, extra];
const availableCourses = [assigned, extra, elective];

function setup(overrides = {}) {
  const props = {
    courses,
    availableCourses,
    onAdd: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<MyCoursesPanel {...props} />), ...props };
}

function selectElective() {
  fireEvent.change(screen.getByLabelText("Add an extra course"), {
    target: { value: "3" },
  });
}

function addButton() {
  return screen.getByRole("button", { name: "Add course" });
}

function removeButton() {
  return screen.getByRole("button", { name: "Remove Statistics" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MyCoursesPanel", () => {
  it("uses the KAN-75 panel and section design", () => {
    const { container } = setup();

    expect(screen.getByRole("region", {
      name: "My courses",
    })).toHaveClass("room-table-panel");

    expect(screen.getByText("2 courses")).toHaveClass("catalogue-total");
    expect(screen.getByRole("heading", {
      name: "Assigned courses",
    })).toHaveClass("slot-section-title");

    expect(container.querySelector(".room-table-toolbar")).not.toBeNull();
    expect(container.querySelector(".list-group")).toBeNull();
    expect(container.querySelector(".alert")).toBeNull();
  });

  it("displays assigned and extra courses", () => {
    setup();

    expect(screen.getByRole("heading", { name: "My courses" })).toBeInTheDocument();
    expect(screen.getByText("Databases")).toBeInTheDocument();
    expect(screen.getByText("Statistics")).toBeInTheDocument();
    expect(screen.getByText("2 courses")).toBeInTheDocument();
  });

  it("does not allow removal of assigned courses", () => {
    setup();

    expect(screen.queryByRole("button", {
      name: "Remove Databases",
    })).not.toBeInTheDocument();
    expect(removeButton()).toBeEnabled();
  });

  it("excludes assigned and enrolled courses from available choices", () => {
    setup();

    expect(screen.queryByRole("option", {
      name: "Databases",
    })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", {
      name: "Statistics",
    })).not.toBeInTheDocument();
    expect(screen.getByRole("option", {
      name: "Computer Networks",
    })).toBeInTheDocument();
  });

  it("adds an extra course using its course ID", async () => {
    const { onAdd } = setup();

    expect(addButton()).toBeDisabled();
    selectElective();
    fireEvent.click(addButton());

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(3));
    await waitFor(() => expect(addButton()).toBeDisabled());
    expect(screen.getByLabelText("Add an extra course")).toHaveValue("");
  });

  it("removes an extra course using its course ID", async () => {
    const { onRemove } = setup();

    fireEvent.click(removeButton());

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(2));
    await waitFor(() => expect(removeButton()).toBeEnabled());
  });

  it("prevents repeated submissions during a pending operation", async () => {
    let resolve;
    const onAdd = vi.fn(() => new Promise((done) => { resolve = done; }));
    const { onRemove } = setup({ onAdd });

    selectElective();
    fireEvent.click(addButton());

    expect(addButton()).toBeDisabled();
    expect(removeButton()).toBeDisabled();
    expect(screen.getByLabelText("Add an extra course")).toBeDisabled();

    fireEvent.click(addButton());
    fireEvent.click(removeButton());

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();

    await act(async () => { resolve(); });
    expect(removeButton()).toBeEnabled();
  });

  it("displays a loading state and hides enrollment controls", () => {
    setup({ loading: true });

    expect(screen.getByRole("status")).toHaveTextContent("Loading your courses");
    expect(screen.queryByRole("button", { name: "Add course" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "Remove Statistics",
    })).not.toBeInTheDocument();
  });

  it("displays enrollment errors and preserves the selected course", async () => {
    setup({
      onAdd: vi.fn().mockRejectedValue(new Error("Already enrolled")),
    });

    selectElective();
    fireEvent.click(addButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Already enrolled");
    expect(screen.getByLabelText("Add an extra course")).toHaveValue("3");
    expect(addButton()).toBeEnabled();
  });

  it("preserves the extra course when removal fails", async () => {
    setup({
      onRemove: vi.fn().mockRejectedValue(new Error("Removal failed")),
    });

    fireEvent.click(removeButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Removal failed");
    expect(screen.getByText("Statistics")).toBeInTheDocument();
    expect(removeButton()).toBeEnabled();
  });

  it("displays empty course and catalogue messages", () => {
    setup({ courses: [], availableCourses: [] });

    expect(screen.getByText("No assigned courses.")).toBeInTheDocument();
    expect(screen.getByText("No extra courses added.")).toBeInTheDocument();
    expect(screen.getByText("No additional courses available.")).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
  });

  it("refreshes the course list when parent data changes", () => {
    const { rerender } = setup();

    rerender(<MyCoursesPanel
      courses={[assigned, { ...elective, is_extra: true }]}
      availableCourses={availableCourses}
    />);

    expect(screen.queryByRole("button", {
      name: "Remove Statistics",
    })).not.toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Remove Computer Networks",
    })).toBeInTheDocument();
    expect(screen.queryByRole("option", {
      name: "Computer Networks",
    })).not.toBeInTheDocument();
  });

  it("does not make direct network requests", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    const { onAdd } = setup();
    selectElective();
    fireEvent.click(addButton());

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(3));
    await waitFor(() => expect(addButton()).toBeDisabled());
    expect(request).not.toHaveBeenCalled();
  });

  it("disables enrollment controls without callbacks", () => {
    setup({ onAdd: undefined, onRemove: undefined });

    expect(addButton()).toBeDisabled();
    expect(removeButton()).toBeDisabled();
    expect(screen.getByLabelText("Add an extra course")).toBeDisabled();
  });
});
