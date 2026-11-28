import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup, fireEvent, render, screen, waitFor, within,
} from "@testing-library/react";
import { apiRequest } from "../../../lib/api.js";
import StudentsPage from "../page.jsx";

vi.mock("../../../lib/api.js", () => ({
  apiRequest: vi.fn(),
}));

const degrees = [
  {
    id: 1,
    name: "Computer Science",
    years: [
      { id: 11, number: 1 },
      { id: 12, number: 2 },
    ],
  },
  {
    id: 2,
    name: "Mathematics",
    years: [{ id: 21, number: 1 }],
  },
];

const mario = {
  id: 1,
  name: "Mario Rossi",
  student_number: "001234",
  degree_id: 1,
  year_id: 11,
};

const anna = {
  id: 2,
  name: "Anna Bianchi",
  student_number: "ABC123",
  degree_id: 2,
  year_id: 21,
};

function mockApi(students = [], handler = () => undefined) {
  vi.mocked(apiRequest).mockImplementation(async (path, options) => {
    const result = handler(path, options);
    if (result !== undefined) return result;

    if (options?.method) {
      throw new Error(`Unexpected ${options.method} ${path}`);
    }

    if (path === "/students") return students;
    if (path === "/degrees") return degrees;
    if (path.startsWith("/degrees/")) {
      return degrees.find((degree) => degree.id === Number(path.split("/").at(-1)));
    }

    throw new Error(`Unexpected API request: ${path}`);
  });
}

function calls(method) {
  return vi.mocked(apiRequest).mock.calls.filter(
    ([, options]) => options?.method === method
  );
}

function fillForm(name, number, degree = "1", year = "11") {
  fireEvent.change(screen.getByLabelText("Full name"), {
    target: { value: name },
  });
  fireEvent.change(screen.getByLabelText("Matricola"), {
    target: { value: number },
  });
  fireEvent.change(screen.getByLabelText("Degree programme"), {
    target: { value: degree },
  });
  fireEvent.change(screen.getByLabelText("Academic year"), {
    target: { value: year },
  });
}

async function openCreateForm() {
  const button = screen.getByRole("button", { name: "Create student" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

function submitCreateForm() {
  fireEvent.click(within(screen.getByRole("dialog"))
    .getByRole("button", { name: "Create student" }));
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("StudentsPage", () => {
  it("lists students with matricola, degree and year", async () => {
    mockApi([mario, anna]);
    render(<StudentsPage />);

    const row = (await screen.findByRole("rowheader", {
      name: "Mario Rossi",
    })).closest("tr");

    expect(within(row).getByText("001234")).toBeInTheDocument();
    expect(within(row).getByText("Computer Science")).toBeInTheDocument();
    expect(within(row).getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", {
      name: "Anna Bianchi",
    })).toBeInTheDocument();
  });

  it("searches students by name and matricola", async () => {
    mockApi([mario, anna]);
    render(<StudentsPage />);
    await screen.findByRole("rowheader", { name: "Mario Rossi" });

    fireEvent.change(screen.getByLabelText("Search students"), {
      target: { value: "rossi" },
    });
    expect(screen.queryByRole("rowheader", {
      name: "Anna Bianchi",
    })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search students"), {
      target: { value: "abc123" },
    });
    expect(screen.getByRole("rowheader", {
      name: "Anna Bianchi",
    })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", {
      name: "Mario Rossi",
    })).not.toBeInTheDocument();
  });

  it("filters students by degree", async () => {
    mockApi([mario, anna]);
    render(<StudentsPage />);
    await screen.findByRole("rowheader", { name: "Mario Rossi" });

    fireEvent.change(screen.getByLabelText("Filter by degree"), {
      target: { value: "2" },
    });

    expect(screen.getByRole("rowheader", {
      name: "Anna Bianchi",
    })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", {
      name: "Mario Rossi",
    })).not.toBeInTheDocument();
  });

  it("paginates students", async () => {
    const students = Array.from({ length: 11 }, (_, index) => ({
      ...mario,
      id: index + 1,
      name: `Student ${index + 1}`,
      student_number: `MAT-${index + 1}`,
    }));

    mockApi(students);
    render(<StudentsPage />);

    await screen.findByRole("rowheader", { name: "Student 1" });

    expect(screen.getByRole("rowheader", {
      name: "Student 10",
    })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", {
      name: "Student 11",
    })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("rowheader", {
      name: "Student 11",
    })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing 11-11 of 11 students"
    );
  });

  it("creates a student and preserves matricola leading zeros", async () => {
    mockApi([], (path, options) =>
      path === "/students" && options?.method === "POST"
        ? mario : undefined
    );

    render(<StudentsPage />);
    await openCreateForm();

    fillForm(" Mario Rossi ", " 001234 ");
    submitCreateForm();

    expect(await screen.findByRole("rowheader", {
      name: "Mario Rossi",
    })).toBeInTheDocument();

    expect(calls("POST")).toHaveLength(1);
    expect(JSON.parse(calls("POST")[0][1].body)).toEqual({
      name: "Mario Rossi",
      student_number: "001234",
      degree_id: 1,
      year_id: 11,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("rejects case-insensitive duplicate matricola", async () => {
    mockApi([anna]);
    render(<StudentsPage />);
    await openCreateForm();

    fillForm("Another Student", "abc123");
    submitCreateForm();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Student number already exists."
    );
    expect(calls("POST")).toHaveLength(0);
  });

  it("resets academic year when the selected degree changes", async () => {
    mockApi([]);
    render(<StudentsPage />);
    await openCreateForm();

    fillForm("New Student", "001111", "1", "12");

    expect(screen.getByLabelText("Academic year")).toHaveValue("12");

    fireEvent.change(screen.getByLabelText("Degree programme"), {
      target: { value: "2" },
    });

    const year = screen.getByLabelText("Academic year");

    expect(year).toHaveValue("");
    expect(within(year).queryByRole("option", {
      name: "Year 2",
    })).not.toBeInTheDocument();
    expect(within(year).getByRole("option", {
      name: "Year 1",
    })).toHaveValue("21");
  });

  it("edits an existing student", async () => {
    mockApi([mario], (path, options) =>
      path === "/students/1" && options?.method === "PUT"
        ? { ...mario, name: "Mario Updated", year_id: 12 }
        : undefined
    );

    render(<StudentsPage />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Edit Mario Rossi",
    }));

    expect(screen.getByLabelText("Matricola")).toHaveValue("001234");

    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Mario Updated" },
    });
    fireEvent.change(screen.getByLabelText("Academic year"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("rowheader", {
      name: "Mario Updated",
    })).toBeInTheDocument();

    expect(calls("PUT")).toHaveLength(1);
    expect(calls("PUT")[0][0]).toBe("/students/1");
    expect(JSON.parse(calls("PUT")[0][1].body)).toEqual({
      name: "Mario Updated",
      student_number: "001234",
      degree_id: 1,
      year_id: 12,
    });
  });

  it("deletes a student only after confirmation", async () => {
    mockApi([mario], (path, options) =>
      path === "/students/1" && options?.method === "DELETE"
        ? null : undefined
    );

    render(<StudentsPage />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Delete Mario Rossi",
    }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "extra course enrollments"
    );
    expect(calls("DELETE")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(screen.queryByRole("rowheader", {
      name: "Mario Rossi",
    })).not.toBeInTheDocument());

    expect(calls("DELETE")).toHaveLength(1);
    expect(calls("DELETE")[0][0]).toBe("/students/1");
  });

  it("keeps the student when deletion is cancelled", async () => {
    mockApi([mario]);
    render(<StudentsPage />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Delete Mario Rossi",
    }));

    fireEvent.click(within(screen.getByRole("dialog"))
      .getByRole("button", { name: "Cancel" }));

    expect(calls("DELETE")).toHaveLength(0);
    expect(screen.getByRole("rowheader", {
      name: "Mario Rossi",
    })).toBeInTheDocument();
  });

  it("displays an API error when student creation fails", async () => {
    mockApi([], (path, options) => {
      if (path === "/students" && options?.method === "POST") {
        throw new Error("Student number already exists.");
      }
    });

    render(<StudentsPage />);
    await openCreateForm();

    fillForm("New Student", "001111");
    submitCreateForm();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Student number already exists."
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(calls("POST")).toHaveLength(1);
  });

  it("preserves the student when deletion fails", async () => {
    mockApi([mario], (path, options) => {
      if (path === "/students/1" && options?.method === "DELETE") {
        throw new Error("Student could not be deleted.");
      }
    });

    render(<StudentsPage />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Delete Mario Rossi",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Student could not be deleted."
    );
    expect(screen.getByRole("rowheader", {
      name: "Mario Rossi",
    })).toBeInTheDocument();
  });

  it("displays loading errors and disables creation", async () => {
    mockApi([], (path) => {
      if (path === "/students") {
        throw new Error("Could not load students.");
      }
    });

    render(<StudentsPage />);

    expect(await screen.findByText(
      "Could not load students."
    )).toBeInTheDocument();

    expect(screen.getByRole("button", {
      name: "Create student",
    })).toBeDisabled();

    expect(screen.queryByText("No students yet")).not.toBeInTheDocument();
  });
});
