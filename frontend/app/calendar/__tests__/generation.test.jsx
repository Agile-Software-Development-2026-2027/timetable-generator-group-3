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
    await screen.findByRole("option", { name: "Computer Science" });
    fireEvent.change(select, { target: { value: "7" } });

    const generateButton = screen.getByRole("button", { name: "Generate timetable" });
    await waitFor(() => expect(generateButton).toBeEnabled());

    expect(global.fetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);

    fireEvent.click(generateButton);
    const dialog = await screen.findByRole("dialog", { name: "Generate a new timetable?" });
    expect(dialog).toHaveTextContent("Computer Science");

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep current timetable" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(global.fetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  });

  it.each([
    ["ok", "Timetable generated"],
    ["partial", "Timetable partially generated"],
    ["infeasible", "Timetable could not be generated"],
  ])("reports %s without calling it full success", async (status, message) => {
    mockApi({ status, sessions_created: status === "infeasible" ? 0 : 2, unscheduled: [] });
    render(<TimetablePage />);

    const generateButton = await screen.findByRole("button", { name: "Generate timetable" });
    await waitFor(() => expect(generateButton).toBeEnabled());
    fireEvent.click(generateButton);

    const confirmation = await screen.findByRole("dialog", { name: "Generate a new timetable?" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Generate timetable" }));

    expect((await screen.findAllByText(new RegExp(message))).length).toBeGreaterThan(0);

    await waitFor(() => {
      const call = global.fetch.mock.calls.find(([, options]) => options?.method === "POST");
      expect(JSON.parse(call[1].body)).toEqual({
  degree_id: 7,
  semester_id: null,
});
    });
  });
});
