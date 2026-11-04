import { describe, it, expect } from "vitest";
import { emptyTeacherForm, matches, teacherFormErrors, teacherFormFromTeacher, teacherPayload, teachersByCourse, toggleId } from "../teacher-form.mjs";

const rossi = { id: 1, name: "Mario Rossi", identifier: "m.rossi@unical.it", courses: [{ id: 10, name: "Databases" }] };

describe("teacher form helpers", () => {
  it("requires a name and an identifier", () => {
    expect(teacherFormErrors({ ...emptyTeacherForm, name: "  " })).toEqual({
      name: "Full name is required.",
      identifier: "Identifier is required.",
    });
  });

  it("flags a duplicate identifier, ignoring case and the teacher being edited", () => {
    const form = { name: "Other", identifier: " M.ROSSI@unical.it ", course_ids: [] };
    expect(teacherFormErrors(form, [rossi]).identifier).toBe("A teacher with the identifier 'M.ROSSI@unical.it' already exists.");
    expect(teacherFormErrors(form, [rossi], 1)).toEqual({});
  });

  it("builds a trimmed payload and a form from a teacher", () => {
    expect(teacherPayload({ name: " A ", identifier: " B ", course_ids: [3] })).toEqual({ name: "A", identifier: "B", course_ids: [3] });
    expect(teacherFormFromTeacher(rossi)).toEqual({ name: "Mario Rossi", identifier: "m.rossi@unical.it", course_ids: [10] });
  });

  it("toggles ids and matches text", () => {
    expect(toggleId([1, 2], 2)).toEqual([1]);
    expect(toggleId([1], 2)).toEqual([1, 2]);
    expect(matches("Mario Rossi", " ross")).toBe(true);
  });

  it("groups teachers by course", () => {
    const bianchi = { id: 2, name: "Anna Bianchi", identifier: "S2", courses: [{ id: 10 }, { id: 11 }] };
    const map = teachersByCourse([rossi, bianchi]);
    expect(map.get(10).map((t) => t.id)).toEqual([1, 2]);
    expect(map.get(11).map((t) => t.id)).toEqual([2]);
  });
});
