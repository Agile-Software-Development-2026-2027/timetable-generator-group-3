import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MySchedulePage from "../page.jsx";
import { useAuth } from "../../components/auth-provider.jsx";

vi.mock("../../components/auth-provider.jsx", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../components/app-shell.jsx", () => ({
  AppNav: ({ current }) => <nav data-testid="navigation">{current}</nav>,
}));

vi.mock("../../components/workload-preferences-form.jsx", () => ({
  default: ({ teacherId }) => (
    <div data-testid="workload-form">{teacherId}</div>
  ),
}));

describe("MySchedulePage - KAN-72", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({
      status: "signed-in",
      role: "teacher",
      me: { teacher_id: 45 },
    });
  });

  afterEach(cleanup);

  it("preserves the teacher schedule placeholder and navigation", () => {
    render(<MySchedulePage />);

    expect(screen.getByRole("heading", { name: "My schedule" })).toBeTruthy();
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.getByTestId("navigation").textContent).toBe("/my-schedule");
  });

  it("passes the authenticated teacher ID to the workload form", () => {
    render(<MySchedulePage />);

    expect(screen.getByTestId("workload-form").textContent).toBe("45");
  });

  it("uses the current teacher ID when the account changes", () => {
    const { rerender } = render(<MySchedulePage />);

    useAuth.mockReturnValue({
      status: "signed-in",
      role: "teacher",
      me: { teacher_id: 87 },
    });

    rerender(<MySchedulePage />);

    expect(screen.getByTestId("workload-form").textContent).toBe("87");
  });

  it.each([null, undefined, 0, -1, 2.5, "45"])(
    "does not render the form for invalid teacher ID %s",
    (teacherId) => {
      useAuth.mockReturnValue({
        status: "signed-in",
        role: "teacher",
        me: { teacher_id: teacherId },
      });

      render(<MySchedulePage />);

      expect(screen.queryByTestId("workload-form")).toBeNull();
      expect(screen.getByRole("alert").textContent).toContain(
        "Your account is not linked to a teacher record."
      );
    }
  );

  it.each(["director", "student"])(
    "does not render the workload form for role %s",
    (role) => {
      useAuth.mockReturnValue({
        status: "signed-in",
        role,
        me: { teacher_id: 45 },
      });

      render(<MySchedulePage />);

      expect(screen.queryByTestId("workload-form")).toBeNull();
    }
  );

  it.each(["loading", "signed-out"])(
    "does not render the form when authentication is %s",
    (status) => {
      useAuth.mockReturnValue({ status });

      render(<MySchedulePage />);

      expect(screen.queryByTestId("workload-form")).toBeNull();
    }
  );
});
