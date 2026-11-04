import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import RoomsPage from "../page.jsx";

const room = (id, overrides = {}) => ({
  id,
  code: `MT${id}`,
  capacity: 100 + id,
  has_projector: false,
  has_computers: false,
  is_lab: false,
  scheduled_sessions: 0,
  ...overrides,
});

function jsonResponse(data, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(data) });
}

function mockApi(rooms, handler = () => undefined) {
  global.fetch = vi.fn((url, options) => {
    const response = handler(url, options);
    return response ?? jsonResponse(rooms);
  });
}

const rowCodes = () => screen.getAllByRole("rowheader").map((cell) => cell.textContent);
const requests = (method) => global.fetch.mock.calls.filter(([, options]) => options?.method === method);

describe("RoomsPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists rooms with their capacity and features", async () => {
    mockApi([room(1, { has_projector: true, is_lab: true })]);
    render(<RoomsPage />);

    const row = (await screen.findByRole("rowheader", { name: "MT1" })).closest("tr");
    expect(within(row).getByText("101")).toBeInTheDocument();
    expect(within(row).getByText("Projector")).toBeInTheDocument();
    expect(within(row).getByText("Lab / PC room")).toBeInTheDocument();
    expect(screen.getByText("1 total")).toBeInTheDocument();
  });

  it("shows ten rows per page and moves with Next and Previous", async () => {
    mockApi(Array.from({ length: 25 }, (_, index) => room(index + 1)));
    render(<RoomsPage />);

    expect(await screen.findByText("Showing 1–10 of 25 rooms")).toBeInTheDocument();
    expect(rowCodes()).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 11–20 of 25 rooms")).toBeInTheDocument();
    expect(rowCodes()[0]).toBe("MT11");

    fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
    expect(screen.getByText("Showing 21–25 of 25 rooms")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("changes the page size and returns to the first page", async () => {
    mockApi(Array.from({ length: 60 }, (_, index) => room(index + 1)));
    render(<RoomsPage />);
    await screen.findByText("Showing 1–10 of 60 rooms");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "50" }));

    expect(screen.getByText("Showing 1–50 of 60 rooms")).toBeInTheDocument();
    expect(rowCodes()).toHaveLength(50);
  });

  it("sorts by a column when its header is clicked", async () => {
    mockApi([room(1), room(2), room(3)]);
    render(<RoomsPage />);
    await screen.findByRole("rowheader", { name: "MT1" });

    fireEvent.click(screen.getByRole("button", { name: /capacity/i }));
    fireEvent.click(screen.getByRole("button", { name: /capacity/i }));

    expect(screen.getByRole("columnheader", { name: /capacity/i })).toHaveAttribute("aria-sort", "descending");
    expect(rowCodes()).toEqual(["MT3", "MT2", "MT1"]);
  });

  it("searches by room code", async () => {
    mockApi([room(1), room(2)]);
    render(<RoomsPage />);
    await screen.findByRole("rowheader", { name: "MT1" });

    fireEvent.change(screen.getByLabelText(/search rooms/i), { target: { value: "mt2" } });
    expect(rowCodes()).toEqual(["MT2"]);

    fireEvent.change(screen.getByLabelText(/search rooms/i), { target: { value: "nothing" } });
    expect(screen.getByText("No rooms match your search")).toBeInTheDocument();
  });

  it("asks the API for rooms with the chosen feature", async () => {
    mockApi([room(1, { is_lab: true })]);
    render(<RoomsPage />);
    await screen.findByRole("rowheader", { name: "MT1" });

    fireEvent.click(screen.getByRole("button", { name: "Lab / PC room" }));

    await waitFor(() => expect(global.fetch.mock.calls.at(-1)[0]).toMatch(/\/rooms\?is_lab=true$/));
  });

  it("explains when rooms cannot be loaded", async () => {
    mockApi([], () => jsonResponse({ detail: "Server unavailable" }, false, 500));
    render(<RoomsPage />);

    expect(await screen.findByText("Rooms could not be loaded")).toBeInTheDocument();
    expect(screen.getByText(/server unavailable/i)).toBeInTheDocument();
  });

  it("blocks an invalid capacity before calling the API", async () => {
    mockApi([]);
    render(<RoomsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /create room/i }));

    fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: "MT9" } });
    fireEvent.change(screen.getByLabelText(/max capacity/i), { target: { value: "0" } });
    fireEvent.submit(screen.getByLabelText(/room name/i).closest("form"));

    expect(await screen.findByText("Capacity must be greater than zero.")).toBeInTheDocument();
    expect(requests("POST")).toHaveLength(0);
  });

  it("creates a room and shows a success notification", async () => {
    mockApi([], (_url, options) => (options?.method === "POST" ? jsonResponse(room(9)) : undefined));
    render(<RoomsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /create room/i }));

    fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: " MT9 " } });
    fireEvent.change(screen.getByLabelText(/max capacity/i), { target: { value: "40" } });
    fireEvent.click(screen.getByLabelText("Projector"));
    fireEvent.submit(screen.getByLabelText(/room name/i).closest("form"));

    expect(await screen.findByText(/room saved successfully/i)).toBeInTheDocument();
    expect(JSON.parse(requests("POST")[0][1].body)).toEqual({
      code: "MT9", capacity: 40, has_projector: true, has_computers: false, is_lab: false,
    });
  });

  it("shows the API's message when a code is a duplicate", async () => {
    mockApi([], (_url, options) => (options?.method === "POST"
      ? jsonResponse({ detail: "A room with this code already exists." }, false, 409)
      : undefined));
    render(<RoomsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /create room/i }));

    fireEvent.change(screen.getByLabelText(/room name/i), { target: { value: "MT1" } });
    fireEvent.change(screen.getByLabelText(/max capacity/i), { target: { value: "40" } });
    fireEvent.submit(screen.getByLabelText(/room name/i).closest("form"));

    expect(await screen.findByText("A room with this code already exists.")).toBeInTheDocument();
  });

  it("edits a room through PUT with the form pre-filled", async () => {
    mockApi([room(1)], (_url, options) => (options?.method === "PUT" ? jsonResponse(room(1)) : undefined));
    render(<RoomsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit MT1" }));

    expect(screen.getByLabelText(/max capacity/i)).toHaveValue(101);
    fireEvent.change(screen.getByLabelText(/max capacity/i), { target: { value: "55" } });
    fireEvent.submit(screen.getByLabelText(/room name/i).closest("form"));

    await waitFor(() => expect(requests("PUT")).toHaveLength(1));
    expect(requests("PUT")[0][0]).toMatch(/\/rooms\/1$/);
    expect(JSON.parse(requests("PUT")[0][1].body).capacity).toBe(55);
  });

  it("deletes an unused room without a warning", async () => {
    mockApi([room(1)], (_url, options) => (options?.method === "DELETE"
      ? Promise.resolve({ ok: true, status: 204 })
      : undefined));
    render(<RoomsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete MT1" }));

    expect(screen.queryByText(/saved timetable/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(requests("DELETE")).toHaveLength(1));
    expect(requests("DELETE")[0][0]).toMatch(/\/rooms\/1$/);
  });

  it("warns before deleting a room used by the timetable", async () => {
    mockApi([room(1, { scheduled_sessions: 2 })], (_url, options) => (options?.method === "DELETE"
      ? Promise.resolve({ ok: true, status: 204 })
      : undefined));
    render(<RoomsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete MT1" }));

    expect(screen.getByRole("alert")).toHaveTextContent("used by 2 scheduled classes in the saved timetable");
    fireEvent.click(screen.getByRole("button", { name: "Delete anyway" }));

    await waitFor(() => expect(requests("DELETE")).toHaveLength(1));
    expect(requests("DELETE")[0][0]).toMatch(/\/rooms\/1\?force=true$/);
  });
});
