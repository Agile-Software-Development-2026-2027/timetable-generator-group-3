import { describe, it, expect } from "vitest";
import { defaultSort, nextSort, pageNumbers, pageSizes, paginate, searchRooms, sortRooms } from "../room-table.mjs";

const room = (code, capacity = 30, scheduled_sessions = 0) => ({ code, capacity, scheduled_sessions });
const codes = (rooms) => rooms.map(({ code }) => code);
const rows = (count) => Array.from({ length: count }, (_, index) => index + 1);

describe("pageSizes", () => {
  it("offers 10, 50 and 100 rows", () => {
    expect(pageSizes).toEqual([10, 50, 100]);
  });
});

describe("searchRooms", () => {
  const rooms = [room("MT1"), room("MT10"), room("LAB-30A"), room("Aula A")];

  it("returns every room for an empty query", () => {
    expect(searchRooms(rooms, "")).toEqual(rooms);
    expect(searchRooms(rooms, "   ")).toEqual(rooms);
  });

  it("matches part of the code, ignoring case and spacing", () => {
    expect(codes(searchRooms(rooms, " mt1 "))).toEqual(["MT1", "MT10"]);
    expect(codes(searchRooms(rooms, "aula"))).toEqual(["Aula A"]);
  });

  it("returns nothing when no code matches", () => {
    expect(searchRooms(rooms, "zzz")).toEqual([]);
  });
});

describe("sortRooms", () => {
  const rooms = [room("MT10", 70, 1), room("MT2", 48, 3), room("LAB-A", 70, 0), room("aula", 112, 1)];

  it("sorts codes in reading order by default", () => {
    expect(codes(sortRooms(rooms, defaultSort))).toEqual(["aula", "LAB-A", "MT2", "MT10"]);
  });

  it("reverses codes when descending", () => {
    expect(codes(sortRooms(rooms, { key: "code", direction: "desc" }))).toEqual(["MT10", "MT2", "LAB-A", "aula"]);
  });

  it("sorts numbers numerically and breaks ties by code", () => {
    expect(codes(sortRooms(rooms, { key: "capacity", direction: "asc" }))).toEqual(["MT2", "LAB-A", "MT10", "aula"]);
    expect(codes(sortRooms(rooms, { key: "capacity", direction: "desc" }))).toEqual(["aula", "LAB-A", "MT10", "MT2"]);
    expect(codes(sortRooms(rooms, { key: "scheduled_sessions", direction: "desc" }))).toEqual(["MT2", "aula", "MT10", "LAB-A"]);
  });

  it("does not change the original list", () => {
    const original = [...rooms];
    sortRooms(rooms, defaultSort);
    expect(rooms).toEqual(original);
  });
});

describe("nextSort", () => {
  it("flips the direction of the active column", () => {
    expect(nextSort(defaultSort, "code")).toEqual({ key: "code", direction: "desc" });
    expect(nextSort({ key: "code", direction: "desc" }, "code")).toEqual({ key: "code", direction: "asc" });
  });

  it("starts ascending on a new column", () => {
    expect(nextSort({ key: "code", direction: "desc" }, "capacity")).toEqual({ key: "capacity", direction: "asc" });
  });
});

describe("paginate", () => {
  it("returns the requested page and its range", () => {
    expect(paginate(rows(25), 2, 10)).toEqual({
      rows: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20], page: 2, pageCount: 3, total: 25, first: 11, last: 20,
    });
  });

  it("handles a short last page", () => {
    expect(paginate(rows(25), 3, 10)).toMatchObject({ rows: [21, 22, 23, 24, 25], first: 21, last: 25 });
  });

  it("fits everything on one page when the size is large enough", () => {
    expect(paginate(rows(19), 1, 50)).toMatchObject({ pageCount: 1, first: 1, last: 19 });
  });

  it("handles an exact multiple without an empty last page", () => {
    expect(paginate(rows(20), 1, 10).pageCount).toBe(2);
  });

  it("moves back when the page no longer exists, e.g. after a delete", () => {
    expect(paginate(rows(20), 3, 10)).toMatchObject({ page: 2, first: 11, last: 20 });
  });

  it("never goes below the first page", () => {
    expect(paginate(rows(5), 0, 10).page).toBe(1);
  });

  it("describes an empty list", () => {
    expect(paginate([], 1, 10)).toEqual({ rows: [], page: 1, pageCount: 1, total: 0, first: 0, last: 0 });
  });
});

describe("pageNumbers", () => {
  it("lists every page when there are few", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(2, 3)).toEqual([1, 2, 3]);
  });

  it("hides distant pages behind gaps", () => {
    expect(pageNumbers(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageNumbers(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageNumbers(10, 10)).toEqual([1, null, 9, 10]);
  });

  it("shows a single hidden page instead of a gap", () => {
    expect(pageNumbers(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
