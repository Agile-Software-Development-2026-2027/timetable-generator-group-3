import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../../../lib/api.js", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("../../../lib/teacher-preferences-api.js", () => ({
  fetchTeacherPreferences: vi.fn(),
  saveTeacherPreferences: vi.fn(),
}));

import { apiRequest } from "../../../lib/api.js";
import {
  fetchTeacherPreferences,
  saveTeacherPreferences,
} from "../../../lib/teacher-preferences-api.js";
import WorkloadPreferencesForm from "../workload-preferences-form.jsx";

const preferences = {
  max_hours_per_day: 4,
  max_teaching_days: 3,
  max_consecutive_hours: 2,
  preferred_part_of_day: "morning",
};

const emptyPreferences = {
  max_hours_per_day: null,
  max_teaching_days: null,
  max_consecutive_hours: null,
  preferred_part_of_day: null,
};

const workingDays = [0, 1, 2, 3, 4];

const daily = () => screen.getByLabelText("Max hours per day");
const days = () => screen.getByLabelText("Max teaching days");
const consecutive = () => screen.getByLabelText("Max consecutive hours");
const part = () => screen.getByLabelText("Preferred part of day");
const save = () => screen.getByRole("button", {
  name: "Save preferences",
});

function change(element, value) {
  fireEvent.change(element, { target: { value } });
}

function deferred() {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

async function renderReady(teacherId = 45) {
  const view = render(
    <WorkloadPreferencesForm teacherId={teacherId} />
  );

  await screen.findByRole("button", {
    name: "Save preferences",
  });

  return view;
}

beforeEach(() => {
  vi.resetAllMocks();

  apiRequest.mockResolvedValue({
    working_days: workingDays,
  });

  fetchTeacherPreferences.mockResolvedValue(preferences);

  saveTeacherPreferences.mockImplementation(
    async (_teacherId, data) => data
  );
});

afterEach(() => {
  cleanup();
});

describe("WorkloadPreferencesForm", () => {
  it("shows loading state before preferences are available", async () => {
    const loading = deferred();

    fetchTeacherPreferences.mockReturnValue(loading.promise);

    render(<WorkloadPreferencesForm teacherId={45} />);

    expect(screen.getByText(
      "Loading workload preferences..."
    )).toBeInTheDocument();

    expect(screen.queryByRole("button", {
      name: "Save preferences",
    })).not.toBeInTheDocument();

    await act(async () => {
      loading.resolve(preferences);
    });

    expect(await screen.findByRole("button", {
      name: "Save preferences",
    })).toBeEnabled();
  });

  it("loads the selected teacher and current working days", async () => {
    await renderReady();

    expect(fetchTeacherPreferences).toHaveBeenCalledWith(45);
    expect(apiRequest).toHaveBeenCalledWith("/slot-config");

    expect(daily()).toHaveValue(4);
    expect(days()).toHaveValue(3);
    expect(consecutive()).toHaveValue(2);
    expect(part()).toHaveValue("morning");
    expect(days()).toHaveAttribute("max", "5");
  });

  it("displays unset preferences as empty optional limits", async () => {
    fetchTeacherPreferences.mockResolvedValue(emptyPreferences);

    await renderReady();

    expect(daily()).toHaveValue(null);
    expect(days()).toHaveValue(null);
    expect(consecutive()).toHaveValue(null);
    expect(part()).toHaveValue("none");
    expect(save()).toBeEnabled();
  });

  it("reuses the existing project form and button classes", async () => {
    await renderReady();

    expect(screen.getByRole("region", {
      name: "Workload preferences",
    })).toHaveClass("slot-card");

    expect(daily()).toHaveClass("form-control");
    expect(days()).toHaveClass("form-control");
    expect(consecutive()).toHaveClass("form-control");
    expect(part()).toHaveClass("form-select");
    expect(save()).toHaveClass("btn", "btn-campus");
  });

  it("saves all edited preferences for the selected teacher", async () => {
    await renderReady();

    change(daily(), "6");
    change(days(), "4");
    change(consecutive(), "3");
    change(part(), "afternoon");

    fireEvent.click(save());

    expect(saveTeacherPreferences).toHaveBeenCalledWith(45, {
      max_hours_per_day: 6,
      max_teaching_days: 4,
      max_consecutive_hours: 3,
      preferred_part_of_day: "afternoon",
    });

    expect(await screen.findByText(
      "Workload preferences saved."
    )).toBeInTheDocument();

    expect(save()).toBeEnabled();
  });

  it("clears optional limits using null values", async () => {
    await renderReady();

    change(daily(), "");
    change(days(), "");
    change(consecutive(), "");
    change(part(), "none");

    fireEvent.click(save());

    expect(saveTeacherPreferences).toHaveBeenCalledWith(45, {
      max_hours_per_day: null,
      max_teaching_days: null,
      max_consecutive_hours: null,
      preferred_part_of_day: "none",
    });

    await screen.findByText("Workload preferences saved.");
  });

  it("uses the saved server response as the new form state", async () => {
    saveTeacherPreferences.mockResolvedValue({
      ...preferences,
      max_hours_per_day: 5,
      preferred_part_of_day: "afternoon",
    });

    await renderReady();

    change(daily(), "6");
    fireEvent.click(save());

    await screen.findByText("Workload preferences saved.");

    expect(daily()).toHaveValue(5);
    expect(part()).toHaveValue("afternoon");
  });

  it.each([
    ["Max hours per day", "0"],
    ["Max hours per day", "-1"],
    ["Max hours per day", "2.5"],
    ["Max teaching days", "0"],
    ["Max teaching days", "-1"],
    ["Max teaching days", "1.5"],
    ["Max consecutive hours", "0"],
    ["Max consecutive hours", "-1"],
    ["Max consecutive hours", "2.5"],
  ])("rejects invalid %s value %s", async (label, value) => {
    await renderReady();

    const input = screen.getByLabelText(label);
    change(input, value);

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveClass("is-invalid");

    expect(screen.getByText(
      "Enter a positive whole number."
    )).toBeInTheDocument();

    expect(save()).toBeDisabled();

    fireEvent.submit(input.closest("form"));

    expect(saveTeacherPreferences).not.toHaveBeenCalled();
  });

  it("rejects teaching days beyond the configured working days", async () => {
    await renderReady();

    change(days(), "6");

    expect(screen.getByText(
      "Enter no more than 5 teaching days."
    )).toBeInTheDocument();

    expect(days()).toHaveAttribute("aria-invalid", "true");
    expect(save()).toBeDisabled();
    expect(saveTeacherPreferences).not.toHaveBeenCalled();
  });

  it("supports fewer configured working days", async () => {
    apiRequest.mockResolvedValue({
      working_days: [0, 2, 4],
    });

    await renderReady();

    expect(days()).toHaveAttribute("max", "3");

    change(days(), "4");

    expect(screen.getByText(
      "Enter no more than 3 teaching days."
    )).toBeInTheDocument();

    expect(save()).toBeDisabled();
  });

  it("respects the backend maximum of six teaching days", async () => {
    apiRequest.mockResolvedValue({
      working_days: [0, 1, 2, 3, 4, 5, 6],
    });

    await renderReady();

    expect(days()).toHaveAttribute("max", "6");

    change(days(), "7");

    expect(save()).toBeDisabled();

    change(days(), "6");

    expect(save()).toBeEnabled();
  });

  it("clears validation errors after correcting the input", async () => {
    await renderReady();

    change(daily(), "-1");

    expect(save()).toBeDisabled();

    change(daily(), "5");

    expect(daily()).toHaveAttribute("aria-invalid", "false");
    expect(daily()).not.toHaveClass("is-invalid");
    expect(daily()).not.toHaveAttribute("aria-describedby");

    expect(screen.queryByText(
      "Enter a positive whole number."
    )).not.toBeInTheDocument();

    expect(save()).toBeEnabled();
  });

  it("connects validation feedback to the invalid field", async () => {
    await renderReady();

    change(daily(), "0");

    const feedbackId = daily().getAttribute("aria-describedby");
    const feedback = document.getElementById(feedbackId);

    expect(feedback).toHaveTextContent(
      "Enter a positive whole number."
    );
  });

  it("disables editing and prevents duplicate saves", async () => {
    const pending = deferred();

    saveTeacherPreferences.mockReturnValue(pending.promise);

    await renderReady();

    const form = daily().closest("form");

    fireEvent.click(save());

    expect(screen.getByRole("button", {
      name: "Saving...",
    })).toBeDisabled();

    expect(daily()).toBeDisabled();
    expect(days()).toBeDisabled();
    expect(consecutive()).toBeDisabled();
    expect(part()).toBeDisabled();

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(saveTeacherPreferences).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(preferences);
    });

    expect(save()).toBeEnabled();
    expect(daily()).toBeEnabled();
  });

  it("shows a load error and supports retrying", async () => {
    fetchTeacherPreferences.mockRejectedValueOnce(
      new Error("Could not load preferences.")
    );

    render(<WorkloadPreferencesForm teacherId={45} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load preferences."
    );

    expect(screen.queryByRole("button", {
      name: "Save preferences",
    })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {
      name: "Retry",
    }));

    await screen.findByRole("button", {
      name: "Save preferences",
    });

    expect(fetchTeacherPreferences).toHaveBeenCalledTimes(2);
    expect(daily()).toHaveValue(4);
  });

  it("handles failure to load the working days configuration", async () => {
    apiRequest.mockRejectedValueOnce(
      new Error("Configuration unavailable.")
    );

    render(<WorkloadPreferencesForm teacherId={45} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Configuration unavailable."
    );

    expect(screen.getByRole("button", {
      name: "Retry",
    })).toBeEnabled();

    expect(saveTeacherPreferences).not.toHaveBeenCalled();
  });

  it("rejects an invalid working days configuration", async () => {
    apiRequest.mockResolvedValue({
      working_days: [],
    });

    render(<WorkloadPreferencesForm teacherId={45} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid working days configuration."
    );
  });

  it("rejects an invalid preferences response", async () => {
    fetchTeacherPreferences.mockResolvedValue(null);

    render(<WorkloadPreferencesForm teacherId={45} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid workload preferences response."
    );
  });

  it("preserves edited values after a failed save", async () => {
    saveTeacherPreferences.mockRejectedValueOnce(
      new Error("Maximum teaching days cannot exceed working days.")
    );

    await renderReady();

    change(daily(), "6");
    change(days(), "4");

    fireEvent.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Maximum teaching days cannot exceed working days."
    );

    expect(daily()).toHaveValue(6);
    expect(days()).toHaveValue(4);
    expect(save()).toBeEnabled();

    fireEvent.click(save());

    await screen.findByText("Workload preferences saved.");

    expect(saveTeacherPreferences).toHaveBeenCalledTimes(2);
  });

  it("allows the success notification to be dismissed", async () => {
    await renderReady();

    fireEvent.click(save());

    await screen.findByText("Workload preferences saved.");

    fireEvent.click(screen.getByRole("button", {
      name: "Dismiss notification",
    }));

    expect(screen.queryByText(
      "Workload preferences saved."
    )).not.toBeInTheDocument();
  });

  it("reloads preferences when the selected teacher changes", async () => {
    const view = await renderReady();

    change(daily(), "9");

    fetchTeacherPreferences.mockResolvedValue({
      ...emptyPreferences,
      max_hours_per_day: 2,
    });

    view.rerender(
      <WorkloadPreferencesForm teacherId={46} />
    );

    await screen.findByRole("button", {
      name: "Save preferences",
    });

    expect(fetchTeacherPreferences).toHaveBeenLastCalledWith(46);
    expect(daily()).toHaveValue(2);
    expect(days()).toHaveValue(null);
    expect(part()).toHaveValue("none");

    fireEvent.click(save());

    expect(saveTeacherPreferences).toHaveBeenCalledWith(46, {
      ...emptyPreferences,
      max_hours_per_day: 2,
      preferred_part_of_day: "none",
    });

    await screen.findByText("Workload preferences saved.");
  });

  it("ignores stale load responses from a previous teacher", async () => {
    const previous = deferred();

    fetchTeacherPreferences
      .mockReturnValueOnce(previous.promise)
      .mockResolvedValueOnce({
        ...preferences,
        max_hours_per_day: 7,
      });

    const view = render(
      <WorkloadPreferencesForm teacherId={45} />
    );

    view.rerender(
      <WorkloadPreferencesForm teacherId={46} />
    );

    await screen.findByRole("button", {
      name: "Save preferences",
    });

    expect(daily()).toHaveValue(7);

    await act(async () => {
      previous.resolve(preferences);
    });

    expect(daily()).toHaveValue(7);
  });

  it("ignores a previous teacher's completed save after switching", async () => {
    const pending = deferred();

    saveTeacherPreferences.mockReturnValueOnce(pending.promise);

    const view = await renderReady();

    fireEvent.click(save());

    fetchTeacherPreferences.mockResolvedValue({
      ...preferences,
      max_hours_per_day: 8,
    });

    view.rerender(
      <WorkloadPreferencesForm teacherId={46} />
    );

    await screen.findByRole("button", {
      name: "Save preferences",
    });

    await act(async () => {
      pending.resolve(preferences);
    });

    expect(daily()).toHaveValue(8);

    expect(screen.queryByText(
      "Workload preferences saved."
    )).not.toBeInTheDocument();
  });

  it.each([undefined, null, 0, -1, "45"])(
    "does not request preferences for invalid teacher ID %s",
    (teacherId) => {
      const { container } = render(
        <WorkloadPreferencesForm teacherId={teacherId} />
      );

      expect(container).toBeEmptyDOMElement();
      expect(fetchTeacherPreferences).not.toHaveBeenCalled();
      expect(apiRequest).not.toHaveBeenCalled();
    }
  );

  it("does not submit invalid stored limits until corrected", async () => {
    fetchTeacherPreferences.mockResolvedValue({
      ...preferences,
      max_teaching_days: 6,
    });

    await renderReady();

    expect(days()).toHaveValue(6);
    expect(save()).toBeDisabled();

    change(days(), "5");

    expect(save()).toBeEnabled();

    fireEvent.click(save());

    await waitFor(() => {
      expect(saveTeacherPreferences).toHaveBeenCalledWith(45, {
        ...preferences,
        max_teaching_days: 5,
      });
    });

    await screen.findByText("Workload preferences saved.");
  });
});
