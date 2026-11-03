import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DataLoaderPage from "../page.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DataLoaderPage pagination", () => {
  it("uses numbered pagination with Previous and Next controls", async () => {
    const records = {
      degrees: [],
      courses: Array.from({ length: 11 }, (_, index) => ({
        id: index + 1,
        name: `Course ${index + 1}`,
        degree: "Computer Science",
        year: 1,
        semester: 1,
        weekly_hours: 4,
        enrolled_students: 80,
        requires_lab: false,
        teachers: [],
      })),
      teachers: [],
      rooms: [],
      years: [],
    };
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(records),
    }));

    render(<DataLoaderPage />);

    expect(await screen.findByText("Course 1")).toBeInTheDocument();
    expect(screen.queryByText("Course 11")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Course 11")).toBeInTheDocument();
    expect(screen.queryByText("Course 1")).not.toBeInTheDocument();
    expect(screen.getByText("11–11 of 11 records")).toBeInTheDocument();
  });
});
