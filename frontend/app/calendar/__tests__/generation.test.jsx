import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import TimetablePage from "../page.jsx";

vi.mock("@fullcalendar/react", () => ({ default: () => <div data-testid="calendar" /> }));
vi.mock("@fullcalendar/react/daygrid", () => ({ default: {} }));
vi.mock("@fullcalendar/react/timegrid", () => ({ default: {} }));
vi.mock("@fullcalendar/react/themes/breezy", () => ({ default: {} }));

const response = (data) => Promise.resolve({
  ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(data)),
});

function mockApi(result) {
  global.fetch = vi.fn((url, options) => {
    if (url.endsWith("/degrees")) return response([{ id: 7, name: "Computer Science" }]);
    if (url.endsWith("/courses")) return response([{ id: 1, degree_id: 7, name: "Algorithms" }]);
    if (url.endsWith("/rooms") || url.includes("/timetable/sessions")) return response([]);
    if (url.endsWith("/timetable/generate") && options?.method === "POST") return response(result);
    return response([]);
  });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Timetable generation", () => {
  it("does not generate when a degree is selected or confirmation is cancelled", async () => {
    mockApi({ status: "ok", sessions_created: 2 });
    render(<TimetablePage />);
    const select = await screen.findByRole("combobox", { name: "Degree programme" });
    fireEvent.change(select, { target: { value: "7" } });
    expect(global.fetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Generate timetable" }));
    const dialog = screen.getByRole("dialog", { name: "Generate a new timetable?" });
    expect(dialog).toHaveTextContent("Computer Science");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep current timetable" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(global.fetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  });

  it.each([
    ["ok", "Timetable generated"],
    ["partial", "Partial timetable"],
    ["infeasible", "Timetable infeasible"],
  ])("reports %s without calling it full success", async (status, message) => {
    mockApi({ status, sessions_created: status === "infeasible" ? 0 : 2, unscheduled: [] });
    render(<TimetablePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate timetable" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm generation" }));
    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
    await waitFor(() => {
      const call = global.fetch.mock.calls.find(([, options]) => options?.method === "POST");
      expect(JSON.parse(call[1].body)).toEqual({ degree_id: 7 });
    });
  });
});
