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
    expect(await screen.findByText(/your catalogue is ready/i)).toBeInTheDocument();
  });

  it("surfaces an error notification when the API fails", async () => {
    mockFetch(() =>
      jsonResponse({ detail: "Server unavailable" }, false, 500)
    );
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

    // Submit the form inside the modal (the "Create degree" submit button is
    // the one living in the same form as the name input).
    fireEvent.submit(nameInput.closest("form"));

    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0].name).toBe("Physics");
    expect(await screen.findByText(/degree saved successfully/i)).toBeInTheDocument();
  });
});
