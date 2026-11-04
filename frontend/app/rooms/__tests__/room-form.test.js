import { describe, it, expect } from "vitest";
import {
  capacityError,
  emptyRoomForm,
  featureFlags,
  roomFeatures,
  roomFormErrors,
  roomFormFromRoom,
  roomPayload,
  roomsPath,
} from "../room-form.mjs";

const editable = { code: "LAB-A", capacity: 30, has_projector: true, has_computers: true, is_lab: true };
const lab = { id: 7, scheduled_sessions: 2, ...editable };

describe("featureFlags", () => {
  it("covers projector, computers and lab rooms", () => {
    expect(featureFlags.map(({ key }) => key)).toEqual(["has_projector", "has_computers", "is_lab"]);
  });
});

describe("capacityError", () => {
  it.each([1, 30, "45", " 120 ", "+8"])("accepts %j", (value) => {
    expect(capacityError(value)).toBe("");
  });

  it.each([0, "0", -3, "-10"])("rejects %j as not positive", (value) => {
    expect(capacityError(value)).toBe("Capacity must be greater than zero.");
  });

  it.each(["", "   ", "abc", "12 seats", "12.5", "1e3", null, undefined])("rejects %j as non-numeric", (value) => {
    expect(capacityError(value)).toBe("Capacity must be a whole number.");
  });
});

describe("roomFormErrors", () => {
  it("is empty for a valid form", () => {
    expect(roomFormErrors({ ...emptyRoomForm, code: "MT1", capacity: "110" })).toEqual({});
  });

  it("requires a code and a capacity", () => {
    expect(roomFormErrors(emptyRoomForm)).toEqual({
      code: "Room code is required.",
      capacity: "Capacity must be a whole number.",
    });
  });

  it("treats a whitespace-only code as missing", () => {
    expect(roomFormErrors({ ...emptyRoomForm, code: "  ", capacity: "10" }).code).toBe("Room code is required.");
  });

  it("reports a non-positive capacity", () => {
    expect(roomFormErrors({ ...emptyRoomForm, code: "MT1", capacity: "0" })).toEqual({
      capacity: "Capacity must be greater than zero.",
    });
  });
});

describe("roomPayload", () => {
  it("trims the code and sends capacity as a number", () => {
    expect(roomPayload({ ...emptyRoomForm, code: "  MT1 ", capacity: " 110 ", has_projector: true })).toEqual({
      code: "MT1", capacity: 110, has_projector: true, has_computers: false, is_lab: false,
    });
  });

  it("only sends the editable fields and round-trips a room unchanged", () => {
    expect(roomPayload(roomFormFromRoom(lab))).toEqual(editable);
  });
});

describe("roomFormFromRoom", () => {
  it("fills every field of the edit form", () => {
    expect(roomFormFromRoom(lab)).toEqual({ ...editable, capacity: "30" });
  });
});

describe("roomsPath", () => {
  it("lists every room without filters", () => {
    expect(roomsPath({ has_projector: false, has_computers: false, is_lab: false })).toBe("/rooms");
    expect(roomsPath({})).toBe("/rooms");
  });

  it("filters to lab rooms", () => {
    expect(roomsPath({ is_lab: true })).toBe("/rooms?is_lab=true");
  });

  it("combines several features", () => {
    expect(roomsPath({ has_projector: true, has_computers: true })).toBe("/rooms?has_projector=true&has_computers=true");
  });
});

describe("roomFeatures", () => {
  it("labels the room's features", () => {
    expect(roomFeatures(lab)).toEqual(["Projector", "Computers", "Lab / PC room"]);
  });

  it("is empty for a plain room", () => {
    expect(roomFeatures({ ...lab, has_projector: false, has_computers: false, is_lab: false })).toEqual([]);
  });
});
