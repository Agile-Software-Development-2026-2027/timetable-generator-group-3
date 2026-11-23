import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../supabase.js", () => ({ supabase: { auth: { getSession } } }));

import { API_URL, apiRequest } from "../api.js";

const reply = (body, status = 200) => Promise.resolve({
  ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError("empty")) : Promise.resolve(body)),
});

const sentHeaders = () => global.fetch.mock.calls[0][1].headers;

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { access_token: "stored-token" } } });
  global.fetch = vi.fn(() => reply([{ id: 1 }]));
});

afterEach(() => vi.restoreAllMocks());

describe("apiRequest", () => {
  it("sends the stored access token as a Bearer header", async () => {
    expect(await apiRequest("/rooms")).toEqual([{ id: 1 }]);
    expect(global.fetch).toHaveBeenCalledWith(`${API_URL}/rooms`, expect.any(Object));
    expect(sentHeaders()).toMatchObject({ Authorization: "Bearer stored-token", "Content-Type": "application/json" });
  });

  it("sends no Authorization header without a session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await apiRequest("/rooms");
    expect(sentHeaders()).not.toHaveProperty("Authorization");
  });

  it("uses a token it is given instead of the stored one", async () => {
    await apiRequest("/auth/me", { token: "fresh-token" });
    expect(sentHeaders().Authorization).toBe("Bearer fresh-token");
    expect(getSession).not.toHaveBeenCalled();
  });

  it("passes the method, body and extra headers on", async () => {
    await apiRequest("/rooms", { method: "POST", body: "{}", headers: { "X-Test": "1" }, cache: "no-store" });
    const [, options] = global.fetch.mock.calls[0];
    expect(options).toMatchObject({ method: "POST", body: "{}", cache: "no-store" });
    expect(options.headers).toMatchObject({ "X-Test": "1", Authorization: "Bearer stored-token" });
  });

  it("returns null for 204 No Content", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 204 }));
    expect(await apiRequest("/rooms/1", { method: "DELETE" })).toBeNull();
  });

  it("throws the API's message with the status", async () => {
    global.fetch = vi.fn(() => reply({ detail: "Not authenticated" }, 401));
    await expect(apiRequest("/auth/me")).rejects.toMatchObject({ message: "Not authenticated", status: 401 });
  });

  it("joins validation messages", async () => {
    global.fetch = vi.fn(() => reply({ detail: [{ msg: "Code is required." }, { msg: "Capacity must be positive." }] }, 422));
    await expect(apiRequest("/rooms")).rejects.toThrow("Code is required. Capacity must be positive.");
  });

  it("falls back to the status when the body has no message", async () => {
    global.fetch = vi.fn(() => reply(undefined, 500));
    await expect(apiRequest("/rooms")).rejects.toMatchObject({ message: "Request failed (500).", status: 500 });
  });
});
