import { describe, expect, it } from "vitest";
import {
  availableRecords, emptyUserForm, linkField, matchesUser, recordLabel, roleLabel, userFormErrors, userFormFromUser,
  userPayload,
} from "../user-form.mjs";

const form = (fields) => ({ ...emptyUserForm, ...fields });

describe("userFormErrors", () => {
  it("needs a valid email when inviting", () => {
    expect(userFormErrors(form({ role: "director", email: "" })).email).toBe("Email is required.");
    expect(userFormErrors(form({ role: "director", email: "ada@" })).email).toBe("Enter a valid email address.");
    expect(userFormErrors(form({ role: "director", email: "ada@unical.it" }))).toEqual({});
  });

  it("does not ask for the email when editing", () => {
    expect(userFormErrors(form({ role: "director", email: "" }), { editing: true })).toEqual({});
  });

  it("needs the record that matches the role", () => {
    expect(userFormErrors(form({ email: "a@b.it", role: "teacher" })).teacher_id).toMatch(/Choose the teacher/);
    expect(userFormErrors(form({ email: "a@b.it", role: "student" })).student_id).toMatch(/Choose the student/);
    expect(userFormErrors(form({ email: "a@b.it", role: "teacher", teacher_id: "3" }))).toEqual({});
  });
});

describe("userPayload", () => {
  it("sends a normalised email and only the link of the chosen role", () => {
    expect(userPayload(form({ email: " Ada@Unical.IT ", role: "teacher", teacher_id: "3", student_id: "9" })))
      .toEqual({ email: "ada@unical.it", role: "teacher", teacher_id: 3, student_id: null });
    expect(userPayload(form({ email: "a@b.it", role: "student", teacher_id: "3", student_id: "9" })))
      .toEqual({ email: "a@b.it", role: "student", teacher_id: null, student_id: 9 });
    expect(userPayload(form({ email: "a@b.it", role: "director", teacher_id: "3" })))
      .toEqual({ email: "a@b.it", role: "director", teacher_id: null, student_id: null });
  });

  it("leaves the email out when editing", () => {
    expect(userPayload(form({ email: "a@b.it", role: "director" }), { editing: true }))
      .toEqual({ role: "director", teacher_id: null, student_id: null });
  });
});

describe("availableRecords", () => {
  const teachers = [{ id: 1, name: "Ada" }, { id: 2, name: "Alan" }, { id: 3, name: "Emmy" }];
  const users = [{ id: "u1", teacher_id: 1 }, { id: "u2", teacher_id: 2 }, { id: "u3", student_id: 3 }];

  it("hides records already linked to another account", () => {
    expect(availableRecords(teachers, users, "teacher_id").map((t) => t.id)).toEqual([3]);
  });

  it("keeps the record of the account being edited", () => {
    expect(availableRecords(teachers, users, "teacher_id", "u2").map((t) => t.id)).toEqual([2, 3]);
  });
});

describe("helpers", () => {
  it("maps roles to their link field and label", () => {
    expect(linkField("teacher")).toBe("teacher_id");
    expect(linkField("student")).toBe("student_id");
    expect(linkField("director")).toBeNull();
    expect(roleLabel("director")).toBe("Programme director");
  });

  it("labels students with their matricola", () => {
    expect(recordLabel({ name: "Grace", student_number: "M100" }, "student_id")).toBe("Grace (M100)");
    expect(recordLabel({ name: "Ada" }, "teacher_id")).toBe("Ada");
  });

  it("builds the form from an account", () => {
    expect(userFormFromUser({ email: null, role: "student", teacher_id: null, student_id: 9 }))
      .toEqual({ email: "", role: "student", teacher_id: "", student_id: "9" });
  });

  it("searches email and linked name, and filters by role", () => {
    const user = { email: "ada@unical.it", linked_name: "Ada Lovelace", role: "teacher" };
    expect(matchesUser(user, "LOVELACE", "")).toBe(true);
    expect(matchesUser(user, "ada@", "teacher")).toBe(true);
    expect(matchesUser(user, "", "student")).toBe(false);
    expect(matchesUser({ email: null, linked_name: null, role: "director" }, "", "")).toBe(true);
  });
});
