export { apiRequest as request } from "../../lib/api.js";

export const emptyTeacherForm = { name: "", identifier: "", course_ids: [] };

export function teacherFormErrors(form, teachers = [], editingId = null) {
  const errors = {};
  if (!form.name.trim()) errors.name = "Full name is required.";
  const identifier = form.identifier.trim();
  if (!identifier) errors.identifier = "Identifier is required.";
  else if (teachers.some((t) => t.id !== editingId && t.identifier.toLowerCase() === identifier.toLowerCase())) {
    errors.identifier = `A teacher with the identifier '${identifier}' already exists.`;
  }
  return errors;
}

export function teacherPayload(form) {
  return { name: form.name.trim(), identifier: form.identifier.trim(), course_ids: form.course_ids };
}

export function teacherFormFromTeacher(teacher) {
  return { name: teacher.name, identifier: teacher.identifier, course_ids: teacher.courses.map((course) => course.id) };
}

export function toggleId(ids, id) {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

export function matches(text, query) {
  return text.toLowerCase().includes(query.trim().toLowerCase());
}

// Course id -> teachers assigned to it, built from the teacher list.
export function teachersByCourse(teachers) {
  const map = new Map();
  for (const teacher of teachers) {
    for (const course of teacher.courses) {
      map.set(course.id, [...(map.get(course.id) ?? []), teacher]);
    }
  }
  return map;
}
