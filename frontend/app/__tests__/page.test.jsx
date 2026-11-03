import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DegreesPage from "../page.jsx";

function mockFetch(handler) {
  global.fetch = vi.fn(handler);
}

function jsonResponse(data, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

describe("DegreesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the list of degrees returned by the API", async () => {
    mockFetch((url) => {
      if (url.endsWith("/degrees")) {
        return jsonResponse([
          { id: 1, name: "Computer Science", years: 3, courses: 14 },
          { id: 2, name: "Mathematics", years: 2, courses: 0 },
        ]);
      }
      return jsonResponse([]);
    });

    render(<DegreesPage />);

    expect(await screen.findByText("Computer Science")).toBeInTheDocument();
    expect(screen.getByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("2 total")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Computer Science" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Computer Science" }).querySelector("svg")).toBeInTheDocument();
  });

  it("shows each semester's course count from degree details", async () => {
    mockFetch((url) => {
      if (url.endsWith("/degrees")) {
        return jsonResponse([
          { id: 1, name: "Computer Science", years: 1, courses: 1 },
        ]);
      }
      return jsonResponse({
        id: 1,
        name: "Computer Science",
        years: [{
          id: 1,
          number: 1,
          semesters: [
            { id: 1, number: 1, courses: 1 },
            { id: 2, number: 2, courses: 0 },
          ],
        }],
      });
    });

    render(<DegreesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Computer Science" }));

    expect(await screen.findByText("1 course")).toBeInTheDocument();
    expect(screen.getByText("0 courses")).toBeInTheDocument();
  });

  it("shows database course counts for each year in the degree structure", async () => {
    mockFetch((url) => {
      if (url.endsWith("/degrees")) {
        return jsonResponse([
          { id: 1, name: "Computer Science", years: 2, courses: 3 },
        ]);
      }
      return jsonResponse({
        id: 1,
        name: "Computer Science",
        years: [
          {
            id: 1,
            number: 1,
            courses: 2,
            semesters: [
              { id: 1, number: 1, courses: 2 },
              { id: 2, number: 2, courses: 0 },
            ],
          },
          {
            id: 2,
            number: 2,
            courses: 1,
            semesters: [{ id: 3, number: 1, courses: 1 }],
          },
        ],
      });
    });

    render(<DegreesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Computer Science", exact: true }));

    expect(await screen.findAllByText("2 courses")).toHaveLength(2);
    expect(screen.getAllByText("1 course")).toHaveLength(2);
    expect(screen.getAllByText("Semester 1")).toHaveLength(2);
    expect(screen.getByText("Semester 2")).toBeInTheDocument();
    expect(screen.getAllByText("0 courses")).toHaveLength(1);
  });

  it("shows degree programmes on separate pages", async () => {
    const degrees = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1,
      name: `Degree ${index + 1}`,
      years: 3,
      courses: 10,
    }));
    mockFetch(() => jsonResponse(degrees));

    render(<DegreesPage />);

    expect(await screen.findByText("Degree 1")).toBeInTheDocument();
    expect(screen.getByText("Degree 10")).toBeInTheDocument();
    expect(screen.queryByText("Degree 11")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "50" } });
    expect(screen.getByText("Degree 11")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1–11 of 11 degree programmes");
    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "10" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Degree 11")).toBeInTheDocument();
    expect(screen.queryByText("Degree 1")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 11–11 of 11 degree programmes");
  });

  it("shows degree programmes on separate pages", async () => {
    const degrees = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1,
      name: `Degree ${index + 1}`,
      years: 3,
      courses: 10,
    }));
    mockFetch(() => jsonResponse(degrees));

    render(<DegreesPage />);

    expect(await screen.findByText("Degree 1")).toBeInTheDocument();
    expect(screen.getByText("Degree 10")).toBeInTheDocument();
    expect(screen.queryByText("Degree 11")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Degree 11")).toBeInTheDocument();
    expect(screen.queryByText("Degree 1")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 11–11 of 11 degree programmes");
  });

  it("shows the create-degree action", async () => {
    mockFetch(() => jsonResponse([]));
    render(<DegreesPage />);
    expect(
      await screen.findByRole("button", { name: /create degree/i })
    ).toBeInTheDocument();
  });

  it("shows an empty state when there are no degrees", async () => {
    mockFetch(() => jsonResponse([]));
    render(<DegreesPage />);
    expect(await screen.findByText(/no degree programmes yet/i)).toBeInTheDocument();
  });

  it("surfaces an error notification when the API fails", async () => {
    mockFetch(() => jsonResponse({ detail: "Server unavailable" }, false, 500));
    render(<DegreesPage />);
    expect(await screen.findByText(/server unavailable/i)).toBeInTheDocument();
  });

  it("opens the create form modal with its heading", async () => {
    mockFetch(() => jsonResponse([]));
    render(<DegreesPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: /create degree/i })
    );

    expect(
      await screen.findByRole("heading", { name: "Create a degree" })
    ).toBeInTheDocument();
  });

  it("submits a new degree and shows a success notification", async () => {
    const posted = [];
    mockFetch((url, options) => {
      if (options?.method === "POST") {
        posted.push(JSON.parse(options.body));
        return jsonResponse({ id: 3, name: "Physics", years: [] });
      }
      if (url.endsWith("/degrees")) return jsonResponse([]);
      return jsonResponse({ id: 3, name: "Physics", years: [] });
    });

    render(<DegreesPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /create degree/i })
    );

    const nameInput = screen.getByLabelText(/degree name/i);
    fireEvent.change(nameInput, { target: { value: "Physics" } });
    fireEvent.submit(nameInput.closest("form"));

    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0].name).toBe("Physics");
    expect(
      await screen.findByText(/degree saved successfully/i)
    ).toBeInTheDocument();
  });

  it("shows a prominent success popup after updating a degree", async () => {
    const fullDegree = {
      id: 1,
      name: "Computer Science",
      years: [{ id: 1, number: 1, courses: 0, semesters: [{ id: 1, number: 1, courses: 0 }] }],
    };
    mockFetch((url, options) => {
      if (options?.method === "PUT") {
        return jsonResponse({ ...fullDegree, name: "Applied Computer Science" });
      }
      if (url.endsWith("/degrees")) {
        return jsonResponse([{ id: 1, name: "Computer Science", years: 1, courses: 0 }]);
      }
      return jsonResponse(fullDegree);
    });

    render(<DegreesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Computer Science" }));
    fireEvent.change(await screen.findByLabelText("Degree name"), {
      target: { value: "Applied Computer Science" },
    });
    fireEvent.submit(screen.getByLabelText("Degree name").closest("form"));

    const notification = (await screen.findByText("Degree updated successfully.")).closest("[role='status']");
    expect(notification).toHaveClass("app-notification-success-prominent");
  });
});
