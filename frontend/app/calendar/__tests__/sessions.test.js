import { describe, it, expect, vi } from "vitest";
import { SESSION_PAGE_SIZE, fetchAllSessions } from "../sessions.mjs";

const sessions = (count, start = 1) => Array.from({ length: count }, (_, index) => ({ id: start + index }));

describe("fetchAllSessions", () => {
  it("asks for the largest page the API allows", async () => {
    const request = vi.fn(() => Promise.resolve(sessions(3)));

    await fetchAllSessions(request);

    expect(request).toHaveBeenCalledWith(`/timetable/sessions?page=1&page_size=${SESSION_PAGE_SIZE}`);
  });

  it("stops after one request when everything fits on a page", async () => {
    const request = vi.fn(() => Promise.resolve(sessions(3)));

    expect(await fetchAllSessions(request)).toHaveLength(3);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when there are no sessions", async () => {
    const request = vi.fn(() => Promise.resolve([]));

    expect(await fetchAllSessions(request)).toEqual([]);
  });

  it("keeps fetching pages until a short one arrives", async () => {
    const pages = [sessions(SESSION_PAGE_SIZE), sessions(SESSION_PAGE_SIZE, 501), sessions(7, 1001)];
    const request = vi.fn(() => Promise.resolve(pages.shift()));

    const all = await fetchAllSessions(request);

    expect(all).toHaveLength(2 * SESSION_PAGE_SIZE + 7);
    expect(all.at(-1).id).toBe(1007);
    expect(request.mock.calls.map(([path]) => path.match(/[?&]page=(\d+)/)[1])).toEqual(["1", "2", "3"]);
  });

  it("asks for one more page when the last page is exactly full", async () => {
    const pages = [sessions(SESSION_PAGE_SIZE), []];
    const request = vi.fn(() => Promise.resolve(pages.shift()));

    expect(await fetchAllSessions(request)).toHaveLength(SESSION_PAGE_SIZE);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("passes errors on to the caller", async () => {
    const request = vi.fn(() => Promise.reject(new Error("Server unavailable")));

    await expect(fetchAllSessions(request)).rejects.toThrow("Server unavailable");
  });
});
