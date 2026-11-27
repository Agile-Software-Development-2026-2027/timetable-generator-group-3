import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import TimetablePage from "./page.jsx";
import {
  apiRequest,
  fetchPreflightWarnings,
} from "../../lib/api.js";

vi.mock("../../lib/api.js", () => ({
  apiRequest: vi.fn(),
  fetchPreflightWarnings: vi.fn(),
}));

vi.mock("../components/app-shell.jsx", () => ({
  AppNav: () => null,
}));

vi.mock("./publication-panel.jsx", () => ({
  PublicationPanel: () => null,
}));

vi.mock("./session-details-dialog.jsx", () => ({
  default: () => null,
}));

vi.mock("@fullcalendar/react", () => ({
  default: () => <div data-testid="mock-calendar" />,
}));

vi.mock("@fullcalendar/react/daygrid", () => ({
  default: {},
}));

vi.mock("@fullcalendar/react/timegrid", () => ({
  default: {},
}));

vi.mock("@fullcalendar/react/list", () => ({
  default: {},
}));

vi.mock("@fullcalendar/react/themes/breezy", () => ({
  default: {},
}));

const degrees = [
  { id: 7, name: "Computer Science" },
  { id: 8, name: "Mathematics" },
];

const warning = {
  type: "missing_teacher",
  severity: "warning",
  message: "Databases: No teacher is assigned.",
  course_id: 12,
};

const error = {
  type: "room_capacity",
  severity: "error",
  message: "Databases: No room fits 150 students.",
  course_id: 12,
};

function generationCalls() {
  return apiRequest.mock.calls.filter(
    ([path]) => path === "/timetable/generate"
  );
}

async function openConfirmation() {
  await waitFor(() => {
    expect(
      screen.getByLabelText("Degree programme", { exact: true })
    ).toHaveValue("7");
  });

  fireEvent.click(
    screen.getByRole("button", {
      name: "Generate timetable",
      exact: true,
    })
  );

  return screen.findByRole("dialog", {
    name: "Generate a new timetable?",
  });
}

function confirmButton(dialog) {
  return within(dialog).getByRole("button", {
    name: "Generate timetable",
    exact: true,
  });
}

function acknowledgment(dialog) {
  return within(dialog).getByRole("checkbox", {
    name: /I understand that generation may produce an incomplete timetable/,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();

  fetchPreflightWarnings.mockResolvedValue([]);

  apiRequest.mockImplementation(async (path) => {
    if (path === "/degrees") return degrees;

    if (path.startsWith("/degrees/")) {
      const id = Number(path.split("/").pop());
      return {
        ...degrees.find((degree) => degree.id === id),
        years: [{
          id: 1,
          number: 1,
          semesters: [
            { id: 11, number: 1 },
            { id: 12, number: 2 },
          ],
        }],
      };
    }

    if (path === "/courses") return [];
    if (path === "/rooms") return [];

    if (path === "/slot-config") {
      return {
        working_days: [0, 1, 2, 3, 4],
        start_time: "09:00:00",
        end_time: "18:00:00",
        block_minutes: 30,
      };
    }

    if (path.startsWith("/timetable/sessions")) {
      return [];
    }

    if (path === "/timetable/generate") {
      return {
        status: "ok",
        sessions_created: 0,
        total_sessions: 0,
        unscheduled: [],
      };
    }

    throw new Error(`Unexpected request: ${path}`);
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("KAN-67 calendar generation integration", () => {
  it("allows generation for a clean dataset", async () => {
    render(<TimetablePage />);

    const dialog = await openConfirmation();

    await waitFor(() => {
      expect(confirmButton(dialog)).toBeEnabled();
    });

    expect(
      within(dialog).queryByRole("checkbox")
    ).toBeNull();

    expect(generationCalls()).toHaveLength(0);
  });

  it("allows generation when only warnings exist", async () => {
    fetchPreflightWarnings.mockResolvedValue([warning]);

    render(<TimetablePage />);

    const dialog = await openConfirmation();

    expect(
      await within(dialog).findByText(
        "1 pre-generation warning"
      )
    ).toBeVisible();

    expect(confirmButton(dialog)).toBeEnabled();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
  });

  it("requires acknowledgment when preflight errors exist", async () => {
    fetchPreflightWarnings.mockResolvedValue([error]);

    render(<TimetablePage />);

    const dialog = await openConfirmation();

    expect(
      await within(dialog).findByText(
        "1 pre-generation error detected"
      )
    ).toBeVisible();

    expect(confirmButton(dialog)).toBeDisabled();
    expect(acknowledgment(dialog)).not.toBeChecked();

    fireEvent.click(confirmButton(dialog));

    expect(generationCalls()).toHaveLength(0);

    fireEvent.click(acknowledgment(dialog));

    expect(confirmButton(dialog)).toBeEnabled();

    fireEvent.click(acknowledgment(dialog));

    expect(confirmButton(dialog)).toBeDisabled();
  });

  it("sends the generation request after errors are acknowledged", async () => {
    fetchPreflightWarnings.mockResolvedValue([error]);

    render(<TimetablePage />);

    const dialog = await openConfirmation();

    await within(dialog).findByRole("checkbox");

    expect(generationCalls()).toHaveLength(0);

    fireEvent.click(acknowledgment(dialog));
    fireEvent.click(confirmButton(dialog));

    await waitFor(() => {
      expect(generationCalls()).toHaveLength(1);
    });

    expect(apiRequest).toHaveBeenCalledWith(
      "/timetable/generate",
      {
        method: "POST",
        body: JSON.stringify({
          degree_id: 7,
          semester_id: null,
        }),
      }
    );
  });

  it("blocks generation when the preflight request fails", async () => {
    fetchPreflightWarnings.mockRejectedValue(
      new Error("Preflight service unavailable")
    );

    render(<TimetablePage />);

    const dialog = await openConfirmation();

    expect(
      await within(dialog).findByText(
        /Could not check timetable data: Preflight service unavailable/
      )
    ).toBeVisible();

    expect(confirmButton(dialog)).toBeDisabled();
    expect(generationCalls()).toHaveLength(0);
  });

  it("allows generation after a successful retry", async () => {
    fetchPreflightWarnings.mockRejectedValue(
      new Error("Network unavailable")
    );

    render(<TimetablePage />);

    const dialog = await openConfirmation();

    const retry = await within(dialog).findByRole(
      "button",
      { name: "Retry preflight" }
    );

    expect(confirmButton(dialog)).toBeDisabled();

    fetchPreflightWarnings.mockResolvedValue([]);

    fireEvent.click(retry);

    await waitFor(() => {
      expect(confirmButton(dialog)).toBeEnabled();
    });
  });

  it("blocks generation while the preflight request is pending", async () => {
    let resolveRequest;

    fetchPreflightWarnings.mockImplementation(
      () => new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    render(<TimetablePage />);

    const dialog = await openConfirmation();

    expect(confirmButton(dialog)).toBeDisabled();

    expect(
      within(dialog).getByText("Checking timetable data...")
    ).toBeVisible();

    await act(async () => {
      resolveRequest([]);
    });

    await waitFor(() => {
      expect(confirmButton(dialog)).toBeEnabled();
    });
  });

  it("requires a new acknowledgment after changing degree", async () => {
    fetchPreflightWarnings.mockResolvedValue([error]);

    render(<TimetablePage />);

    const dialog = await openConfirmation();

    await within(dialog).findByRole("checkbox");

    fireEvent.click(acknowledgment(dialog));

    expect(confirmButton(dialog)).toBeEnabled();

    fireEvent.change(
      within(dialog).getByLabelText(/Degree programme/),
      { target: { value: "8" } }
    );

    await waitFor(() => {
      expect(fetchPreflightWarnings).toHaveBeenCalledWith(
        "8",
        expect.objectContaining({
          signal: expect.anything(),
        })
      );

      expect(acknowledgment(dialog)).not.toBeChecked();
      expect(confirmButton(dialog)).toBeDisabled();
    });

    expect(generationCalls()).toHaveLength(0);
  });

  it("ignores outdated warnings after switching degrees", async () => {
    let resolveOldRequest;

    fetchPreflightWarnings.mockImplementation((degreeId) => {
      if (degreeId === "7") {
        return new Promise((resolve) => {
          resolveOldRequest = resolve;
        });
      }

      return Promise.resolve([]);
    });

    render(<TimetablePage />);

    await waitFor(() => {
      expect(fetchPreflightWarnings).toHaveBeenCalledWith(
        "7",
        expect.anything()
      );
    });

    const oldSignal =
      fetchPreflightWarnings.mock.calls[0][1].signal;

    fireEvent.change(
      screen.getByLabelText("Degree programme", { exact: true }),
      { target: { value: "8" } }
    );

    await waitFor(() => {
      expect(oldSignal.aborted).toBe(true);
    });

    expect(
      await screen.findByText("No pre-generation warnings.")
    ).toBeVisible();

    await act(async () => {
      resolveOldRequest([error]);
    });

    expect(
      screen.getByText("No pre-generation warnings.")
    ).toBeVisible();

    expect(
      screen.queryByRole("button", {
        name: /Pre-generation warnings/,
      })
    ).toBeNull();
  });

  it("isolates semester warnings from the degree badge", async () => {
    fetchPreflightWarnings.mockImplementation(
      async (_degreeId, options) => (
        options?.semesterId === "11" ? [] : [error]
      )
    );

    render(<TimetablePage />);

    const dialog = await openConfirmation();

    await within(dialog).findByRole("checkbox");

    fireEvent.change(
      within(dialog).getByLabelText("Semester (optional)"),
      { target: { value: "11" } }
    );

    await waitFor(() => {
      expect(confirmButton(dialog)).toBeEnabled();
    });

    expect(within(dialog).queryByRole("checkbox")).toBeNull();

    expect(fetchPreflightWarnings).toHaveBeenCalledWith(
      "7",
      expect.objectContaining({ semesterId: "11" })
    );

    expect(screen.getByRole("button", {
      name: /Pre-generation warnings/,
    })).toHaveTextContent("1");
  });

  it("requires new acknowledgment after changing semester", async () => {
    fetchPreflightWarnings.mockResolvedValue([error]);

    render(<TimetablePage />);

    const dialog = await openConfirmation();

    await within(dialog).findByRole("checkbox");

    fireEvent.click(acknowledgment(dialog));

    expect(confirmButton(dialog)).toBeEnabled();

    fireEvent.change(
      within(dialog).getByLabelText("Semester (optional)"),
      { target: { value: "12" } }
    );

    await waitFor(() => {
      expect(acknowledgment(dialog)).not.toBeChecked();
      expect(confirmButton(dialog)).toBeDisabled();
    });

    expect(
      within(dialog).getByText(/These checks cover the selected semester/)
    ).toBeVisible();

    expect(generationCalls()).toHaveLength(0);
  });

  it("ignores outdated validation after switching semesters", async () => {
    let resolveOldRequest;

    fetchPreflightWarnings.mockImplementation(
      async (_degreeId, options) => {
        if (options?.semesterId === "11") {
          return new Promise((resolve) => {
            resolveOldRequest = resolve;
          });
        }

        return [];
      }
    );

    render(<TimetablePage />);

    const dialog = await openConfirmation();

    await waitFor(() => {
      expect(confirmButton(dialog)).toBeEnabled();
    });

    const semester = within(dialog).getByLabelText(
      "Semester (optional)"
    );

    fireEvent.change(semester, {
      target: { value: "11" },
    });

    await waitFor(() => {
      expect(resolveOldRequest).toBeDefined();
      expect(confirmButton(dialog)).toBeDisabled();
    });

    const oldRequest = fetchPreflightWarnings.mock.calls.find(
      ([, options]) => options?.semesterId === "11"
    );

    fireEvent.change(semester, {
      target: { value: "12" },
    });

    await waitFor(() => {
      expect(oldRequest[1].signal.aborted).toBe(true);
      expect(confirmButton(dialog)).toBeEnabled();
    });

    await act(async () => {
      resolveOldRequest([error]);
    });

    expect(confirmButton(dialog)).toBeEnabled();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
  });

  it("generates only the validated selected semester", async () => {
    render(<TimetablePage />);

    const dialog = await openConfirmation();

    fireEvent.change(
      within(dialog).getByLabelText("Semester (optional)"),
      { target: { value: "11" } }
    );

    await waitFor(() => {
      expect(fetchPreflightWarnings).toHaveBeenCalledWith(
        "7",
        expect.objectContaining({ semesterId: "11" })
      );

      expect(confirmButton(dialog)).toBeEnabled();
    });

    fireEvent.click(confirmButton(dialog));

    await waitFor(() => {
      expect(generationCalls()).toHaveLength(1);
    });

    expect(apiRequest).toHaveBeenCalledWith(
      "/timetable/generate",
      {
        method: "POST",
        body: JSON.stringify({
          degree_id: 7,
          semester_id: 11,
        }),
      }
    );
  });

  it("does not generate when confirmation is cancelled", async () => {
    render(<TimetablePage />);

    const dialog = await openConfirmation();

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Keep current timetable",
      })
    );

    expect(
      screen.queryByRole("dialog", {
        name: "Generate a new timetable?",
      })
    ).toBeNull();

    expect(generationCalls()).toHaveLength(0);
  });
});
