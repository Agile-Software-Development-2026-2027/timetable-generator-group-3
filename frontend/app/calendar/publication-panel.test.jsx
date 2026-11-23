import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PublicationPanel } from "./publication-panel.jsx";
import { apiRequest } from "../../lib/api.js";

vi.mock("../../lib/api.js", () => ({ apiRequest: vi.fn() }));

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

function mockDirector(status = { published_at: null, published_by: null, has_unpublished_changes: true }) {
  apiRequest.mockImplementation(async (path) => {
    if (path === "/auth/me") return { role: "director" };
    if (path.startsWith("/timetable/publication?")) return status;
    if (path.startsWith("/timetable/publish?")) return {
      published_at: "2026-11-23T14:00:00Z", published_by: "user-id", has_unpublished_changes: false,
    };
    throw new Error(`Unexpected request ${path}`);
  });
}

describe("KAN-71 publication panel", () => {
  it("shows draft status and publishes only after confirmation", async () => {
    mockDirector();
    render(<PublicationPanel degreeId="7" degreeName="Computer Science" />);
    fireEvent.click(await screen.findByRole("button", { name: "Show publication info" }));
    const infoDialog = await screen.findByRole("dialog", { name: "Publication information" });
    expect(await within(infoDialog).findByText("Draft — not visible to teachers and students")).toBeTruthy();
    fireEvent.click(within(infoDialog).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(apiRequest).not.toHaveBeenCalledWith("/timetable/publish?degree_id=7", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Confirm publication" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      "/timetable/publish?degree_id=7", { method: "POST" }
    ));
    fireEvent.click(screen.getByRole("button", { name: "Show publication info" }));
    const publishedDialog = await screen.findByRole("dialog", { name: "Publication information" });
    expect(await within(publishedDialog).findByText(/Published on /)).toBeTruthy();
  });

  it("shows unpublished changes after earlier publication", async () => {
    mockDirector({ published_at: "2026-11-23T14:00:00Z", published_by: "user-id", has_unpublished_changes: true });
    render(<PublicationPanel degreeId="7" degreeName="Computer Science" />);
    fireEvent.click(await screen.findByRole("button", { name: "Show publication info" }));
    const infoDialog = await screen.findByRole("dialog", { name: "Publication information" });
    expect(await within(infoDialog).findByText("Unpublished changes")).toBeTruthy();
  });

  it("only shows status fetch errors after the publication info button is clicked", async () => {
    apiRequest.mockImplementation(async (path) => {
      if (path === "/auth/me") return { role: "director" };
      throw new Error("Failed to fetch");
    });
    render(<PublicationPanel degreeId="7" degreeName="Computer Science" />);

    expect(await screen.findByRole("button", { name: "Show publication info" })).toBeTruthy();
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/timetable/publication?degree_id=7"));
    expect(screen.queryByText("Publication status unavailable")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show publication info" }));
    const infoDialog = await screen.findByRole("dialog", { name: "Publication information" });
    expect(await within(infoDialog).findByText("Publication status unavailable")).toBeTruthy();
    expect(await within(infoDialog).findByRole("alert"))
      .toHaveTextContent("Could not load publication status: Failed to fetch");
  });

  it("does not show publish controls to students", async () => {
    apiRequest.mockResolvedValue({ role: "student" });
    render(<PublicationPanel degreeId="7" degreeName="Computer Science" />);
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/auth/me"));
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(apiRequest).not.toHaveBeenCalledWith(expect.stringContaining("/timetable/publication"));
  });
});
