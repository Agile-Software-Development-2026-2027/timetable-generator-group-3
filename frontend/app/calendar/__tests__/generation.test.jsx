import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import TimetablePage from "../page.jsx";

vi.mock("@fullcalendar/react", () => ({
  default: () => <div data-testid="calendar" />,
}));
vi.mock("@fullcalendar/react/daygrid", () => ({ default: {} }));
vi.mock("@fullcalendar/react/timegrid", () => ({ default: {} }));
vi.mock("@fullcalendar/react/themes/breezy", () => ({ default: {} }));

const response = (data, ok = true, status = 200) =>
  Promise.resolve({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
  });

function mockApi(result, deleteFails = false) {
  global.fetch = vi.fn((url, options) => {
    if (url.endsWith("/degrees")) {
      return response([{ id: 7, name: "Computer Science" }]);
    }

    if (url.endsWith("/courses")) {
      return response([{ id: 1, degree_id: 7, name: "Algorithms" }]);
    }

    if (
      url.includes("/timetable/sessions") &&
      options?.method === "DELETE"
    ) {
      return deleteFails
        ? response({ detail: "Server error" }, false, 500)
        : response([]);
    }

    if (
      url.endsWith("/rooms") ||
      url.includes("/timetable/sessions")
    ) {
      return response([]);
    }

    if (
      url.endsWith("/timetable/generate") &&
      options?.method === "POST"
    ) {
      return response(result);
    }

    return response([]);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Timetable generation", () => {
  it("does not generate when confirmation is cancelled", async () => {
    mockApi({ status: "ok", sessions_created: 2 });
    render(<TimetablePage />);

    const generateButton = await screen.findByRole("button", {
      name: "Generate timetable",
    });

    await waitFor(() => expect(generateButton).toBeEnabled());

    expect(
      global.fetch.mock.calls.some(([, options]) => options?.method === "POST")
    ).toBe(false);

    fireEvent.click(generateButton);

    const dialog = await screen.findByRole("dialog", {
      name: "Generate a new timetable?",
    });

    const select = within(dialog).getByRole("combobox", {
      name: "Degree programme *",
    });

    await within(dialog).findByRole("option", {
      name: "Computer Science",
    });

    fireEvent.change(select, { target: { value: "7" } });

    expect(dialog).toHaveTextContent("Computer Science");

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Keep current timetable",
      })
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    expect(
      global.fetch.mock.calls.some(([, options]) => options?.method === "POST")
    ).toBe(false);
  });

  it.each([
    ["ok", "Timetable generated"],
    ["partial", "Timetable partially generated"],
    ["infeasible", "Timetable could not be generated"],
  ])("reports %s without calling it full success", async (status, message) => {
    mockApi({
      status,
      sessions_created: status === "infeasible" ? 0 : 2,
      unscheduled: [],
    });

    render(<TimetablePage />);

    const generateButton = await screen.findByRole("button", {
      name: "Generate timetable",
    });

    await waitFor(() => expect(generateButton).toBeEnabled());

    fireEvent.click(generateButton);

    const confirmation = await screen.findByRole("dialog", {
      name: "Generate a new timetable?",
    });

    const select = within(confirmation).getByRole("combobox", {
  name: "Degree programme *",
});

await within(confirmation).findByRole("option", {
  name: "Computer Science",
});

fireEvent.change(select, { target: { value: "7" } });

    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: "Generate timetable",
      })
    );

    expect(
      (await screen.findAllByText(new RegExp(message))).length
    ).toBeGreaterThan(0);

    await waitFor(() => {
      const call = global.fetch.mock.calls.find(
        ([, options]) => options?.method === "POST"
      );

      expect(JSON.parse(call[1].body)).toEqual({
        degree_id: 7,
        semester_id: null,
      });
    });
  });
});

describe("Clear timetable", () => {
  it("does not allow clearing when no degree is selected", async () => {
    mockApi({});
    render(<TimetablePage />);

    const clearButton = await screen.findByRole("button", {
      name: "Clear timetable",
    });

    expect(clearButton).toBeDisabled();

    expect(
      global.fetch.mock.calls.some(([, options]) => options?.method === "DELETE")
    ).toBe(false);
  });

  it("clears the timetable for the selected degree", async () => {
    mockApi({});
    render(<TimetablePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Generate timetable" })
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Generate a new timetable?",
    });

    const select = within(dialog).getByRole("combobox", {
      name: "Degree programme *",
    });

    await within(dialog).findByRole("option", {
      name: "Computer Science",
    });

    fireEvent.change(select, { target: { value: "7" } });

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Keep current timetable",
      })
    );

    const clearButton = await screen.findByRole("button", {
      name: "Clear timetable",
    });

    await waitFor(() => expect(clearButton).toBeEnabled());

    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(
        global.fetch.mock.calls.some(
          ([url, options]) =>
            url.includes("/timetable/sessions?degree_id=7") &&
            options?.method === "DELETE"
        )
      ).toBe(true);
    });
  });

  it("shows an error when clearing fails", async () => {
    mockApi({}, true);
    render(<TimetablePage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Generate timetable" })
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Generate a new timetable?",
    });

    const select = within(dialog).getByRole("combobox", {
      name: "Degree programme *",
    });

    await within(dialog).findByRole("option", {
      name: "Computer Science",
    });

    fireEvent.change(select, { target: { value: "7" } });

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Keep current timetable",
      })
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Clear timetable" })
    );

    expect(
      await screen.findByText(/Could not clear the timetable/i)
    ).toBeInTheDocument();
  });
});
