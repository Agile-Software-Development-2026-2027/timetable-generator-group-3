import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import SettingsPage from "../page.jsx";

const config = {
  working_days: [0, 1, 2, 3, 4], working_day_names: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  start_time: "09:00", end_time: "18:00", block_minutes: 60, blocks_per_day: 9,
};

function jsonResponse(data, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(data) });
}

function mockApi({ sessions = [], put } = {}) {
  global.fetch = vi.fn((url, options) => {
    if (options?.method === "PUT") return put ? put(JSON.parse(options.body)) : jsonResponse(config);
    if (url.includes("/timetable/sessions")) return jsonResponse(sessions);
    return jsonResponse(config);
  });
}

const puts = () => global.fetch.mock.calls.filter(([, options]) => options?.method === "PUT");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SettingsPage", () => {
  it("shows the current configuration as an editable form", async () => {
    mockApi();
    render(<SettingsPage />);

    expect(await screen.findByLabelText("Start time")).toHaveValue("09:00");
    expect(screen.getByLabelText("End time")).toHaveValue("18:00");
    expect(screen.getByLabelText("Block length (minutes)")).toHaveValue(60);
    expect(screen.getByLabelText("Mon")).toBeChecked();
    expect(screen.getByLabelText("Sat")).not.toBeChecked();
    expect(screen.getByText("Mon–Fri · 09:00–18:00 · 60 min blocks → 9 slots/day × 5 days = 45 total slots")).toBeInTheDocument();
  });

  it("updates the live preview while the user types", async () => {
    mockApi();
    render(<SettingsPage />);
    fireEvent.change(await screen.findByLabelText("Block length (minutes)"), { target: { value: "90" } });
    fireEvent.click(screen.getByLabelText("Sat"));

    expect(screen.getByText("Mon–Sat · 09:00–18:00 · 90 min blocks → 6 slots/day × 6 days = 36 total slots")).toBeInTheDocument();
  });

  it("shows inline errors and blocks saving for an invalid configuration", async () => {
    mockApi();
    render(<SettingsPage />);
    fireEvent.change(await screen.findByLabelText("End time"), { target: { value: "08:00" } });
    fireEvent.change(screen.getByLabelText("Block length (minutes)"), { target: { value: "0" } });
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) fireEvent.click(screen.getByLabelText(day));

    expect(screen.getByText("End time must be after start time.")).toBeInTheDocument();
    expect(screen.getByText("Block length must be a whole number greater than 0.")).toBeInTheDocument();
    expect(screen.getByText("Select at least one working day.")).toBeInTheDocument();
    expect(screen.getByText("Fix the highlighted fields to see the grid preview.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save configuration" })).toBeDisabled();
  });

  it("warns when the range is shorter than one block", async () => {
    mockApi();
    render(<SettingsPage />);
    fireEvent.change(await screen.findByLabelText("End time"), { target: { value: "09:30" } });

    expect(screen.getByText("The time range is shorter than one block.")).toBeInTheDocument();
  });

  it("checks the range against a block length typed by the user", async () => {
    mockApi();
    render(<SettingsPage />);
    fireEvent.change(await screen.findByLabelText("Block length (minutes)"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "10:00" } });

    expect(screen.getByText("The time range is shorter than one block.")).toBeInTheDocument();
    expect(screen.getByLabelText("Block length (minutes)")).toHaveAttribute("aria-describedby", "block_minutes-error");
    expect(screen.getByLabelText("Start time")).not.toHaveAttribute("aria-describedby");
    expect(screen.getByRole("button", { name: "Save configuration" })).toBeDisabled();
  });

  it("saves with PUT /slot-config and shows a success notification", async () => {
    mockApi({ put: (body) => jsonResponse({ ...config, ...body, start_time: "08:00", end_time: "18:00", block_minutes: 120 }) });
    render(<SettingsPage />);
    fireEvent.change(await screen.findByLabelText("Start time"), { target: { value: "08:00" } });
    fireEvent.change(screen.getByLabelText("Block length (minutes)"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));

    expect(await screen.findByText("Slot configuration saved.")).toBeInTheDocument();
    expect(puts()[0][0]).toMatch(/\/slot-config$/);
    expect(JSON.parse(puts()[0][1].body)).toEqual({
      working_days: [0, 1, 2, 3, 4], start_time: "08:00:00", end_time: "18:00:00", block_minutes: 120,
    });
  });

  it("shows the API error when saving fails", async () => {
    mockApi({ put: () => jsonResponse({ detail: "end_time must be after start_time." }, false, 422) });
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Save configuration" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("end_time must be after start_time.");
  });

  it("shows a warning banner only when a saved timetable exists", async () => {
    mockApi({ sessions: [{ id: 1 }] });
    render(<SettingsPage />);
    expect(await screen.findByText(/Changing the grid will not automatically regenerate existing timetables./)).toBeInTheDocument();
    cleanup();

    mockApi({ sessions: [] });
    render(<SettingsPage />);
    await screen.findByLabelText("Start time");
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/regenerate existing timetables/)).not.toBeInTheDocument();
  });
});
