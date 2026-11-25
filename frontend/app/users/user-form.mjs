// Form rules and table helpers for the Users page (KAN-69).

export const ROLES = [["director", "Programme director"], ["teacher", "Teacher"], ["student", "Student"]];
export const STATUS_LABELS = { invited: "Invite sent", active: "Active", deactivated: "Deactivated" };

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const emptyUserForm = { email: "", role: "teacher", teacher_id: "", student_id: "" };

export function roleLabel(role) {
  return ROLES.find(([value]) => value === role)?.[1] ?? role;
}

export function userFormFromUser(user) {
  return {
    email: user.email ?? "",
    role: user.role,
    teacher_id: user.teacher_id ? String(user.teacher_id) : "",
    student_id: user.student_id ? String(user.student_id) : "",
  };
}

// Which field links the account to a record, for roles that have one.
export function linkField(role) {
  return { teacher: "teacher_id", student: "student_id" }[role] ?? null;
}

export function userFormErrors(form, { editing = false } = {}) {
  const errors = {};
  const email = form.email.trim();
  if (!editing) {
    if (!email) errors.email = "Email is required.";
    else if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address.";
  }
  if (form.role === "teacher" && !form.teacher_id) errors.teacher_id = "Choose the teacher this account belongs to.";
  if (form.role === "student" && !form.student_id) errors.student_id = "Choose the student this account belongs to.";
  return errors;
}

// The body for POST /users (with email) or PATCH /users/{id} (without).
export function userPayload(form, { editing = false } = {}) {
  return {
    ...(editing ? {} : { email: form.email.trim().toLowerCase() }),
    role: form.role,
    teacher_id: form.role === "teacher" ? Number(form.teacher_id) : null,
    student_id: form.role === "student" ? Number(form.student_id) : null,
  };
}

// Records that are free to link: not used by another account. The account
// being edited keeps its own record in the list.
export function availableRecords(records, users, field, editingUserId = null) {
  const taken = new Set(users.filter((user) => user.id !== editingUserId && user[field]).map((user) => user[field]));
  return records.filter((record) => !taken.has(record.id));
}

export function recordLabel(record, field) {
  return field === "student_id" ? `${record.name} (${record.student_number})` : record.name;
}

export function matchesUser(user, term, role) {
  const text = `${user.email ?? ""} ${user.linked_name ?? ""}`.toLowerCase();
  return (!role || user.role === role) && text.includes(term.trim().toLowerCase());
}
