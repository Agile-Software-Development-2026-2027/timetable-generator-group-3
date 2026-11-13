
import { afterEach, expect, it, vi } from "vitest";
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
  default: () => <div>Calendar</div>,
}));
vi.mock("@fullcalendar/react/daygrid", () => ({ default: {} }));
vi.mock("@fullcalendar/react/timegrid", () => ({ default: {} }));
vi.mock("@fullcalendar/react/list", () => ({ default: {} }));
vi.mock("@fullcalendar/react/themes/breezy", () => ({ default: {} }));

const reply = (data) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(data)),
  });

function mockApi(result) {
  global.fetch = vi.fn((url, options) => {
    if (url.endsWith("/degrees/7")) {
      return reply({ id: 7, name: "Computer Science", years: [] });
    }

    if (url.endsWith("/degrees")) {
      return reply([{ id: 7, name: "Computer Science" }]);
    }

    if (url.endsWith("/courses")) {
      return reply([
        {
          id: 1,
          degree_id: 7,
          name: "Physics",
          weekly_hours: 3,
        },
        {
          id: 2,
          degree_id: 7,
          name: "Math",
          weekly_hours: 2,
        },
      ]);
    }

    if (
      url.endsWith("/rooms") ||
      url.includes("/timetable/sessions")
    ) {
      return reply([]);
    }

    if (
      url.endsWith("/timetable/generate") &&
      options?.method === "POST"
    ) {
      return reply(result);
    }

    return reply([]);
  });
}

async function generate() {
  // Wait until degree programmes have loaded.
  const button = await screen.findByRole("button", {
    name: "Generate timetable",
  });

  await waitFor(() => {
    expect(button).toBeEnabled();
  });

  fireEvent.click(button);

  // Wait for the confirmation dialog.
  const confirm = await screen.findByRole("dialog", {
    name: "Generate a new timetable?",
  });

  fireEvent.click(
    within(confirm).getByRole("button", {
      name: "Generate timetable",
    })
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

it("shows partial results and the unscheduled course reason", async () => {
  mockApi({
    status: "partial",
    sessions_created: 2,
    unscheduled: [
      {
        course_id: 1,
        name: "Physics",
        reason: "No lab has enough seats",
      },
    ],
  });

  render(<TimetablePage />);
  await generate();

  const dialog = await screen.findByRole("dialog", {
    name: "Timetable partially generated",
  });

  expect(dialog).toHaveTextContent(
    "2 of 5 required sessions placed"
  );
  expect(dialog).toHaveTextContent("Physics");
  expect(dialog).toHaveTextContent("No lab has enough seats");

  expect(
    within(dialog).getByRole("progressbar")
  ).toHaveAttribute("aria-valuenow", "2");

  expect(dialog).toHaveTextContent("40%");
});

it("shows infeasible results without reporting success", async () => {
  mockApi({
    status: "infeasible",
    sessions_created: 0,
    unscheduled: [],
  });

  render(<TimetablePage />);
  await generate();

  const dialog = await screen.findByRole("dialog", {
    name: "Timetable could not be generated",
  });

  expect(dialog).toHaveTextContent(
    "No unscheduled course details were provided."
  );

  expect(dialog).not.toHaveTextContent(
    "All required courses were scheduled."
  );
});

it("restores the saved result after remounting", async () => {
  mockApi({
    status: "partial",
    sessions_created: 2,
    unscheduled: [
      {
        course_id: 1,
        name: "Physics",
        reason: "Teacher unavailable",
      },
    ],
  });

  const first = render(<TimetablePage />);
  await generate();

  const dialog = await screen.findByRole("dialog", {
    name: "Timetable partially generated",
  });

  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "View timetable",
    })
  );

  expect(
    window.localStorage.getItem(
      "timetable-generator:last-generation-result"
    )
  ).toContain("Teacher unavailable");

  first.unmount();

  mockApi(null);
  render(<TimetablePage />);

  const lastResultButton = await screen.findByRole("button", {
    name: "View last result",
  });

  fireEvent.click(lastResultButton);

  const restoredDialog = await screen.findByRole("dialog", {
    name: "Timetable partially generated",
  });

  expect(restoredDialog).toHaveTextContent(
    "Teacher unavailable"
  );
});

it("shows completed progress for a successful generation", async () => {
  mockApi({
    status: "ok",
    sessions_created: 5,
    unscheduled: [],
  });

  render(<TimetablePage />);
  await generate();

  const dialog = await screen.findByRole("dialog", {
    name: "Timetable generated",
  });

  expect(dialog).toHaveTextContent(
    "5 of 5 required sessions placed"
  );

  expect(dialog).toHaveTextContent("100%");
});
