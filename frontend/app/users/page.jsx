"use client";

import { Pencil, UserPlus, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api.js";
import { AppNav, Notification, useNotification } from "../components/app-shell.jsx";
import { useAuth } from "../components/auth-provider.jsx";
import { paginate, pageSizes } from "../rooms/room-table.mjs";
import {
  ROLES, STATUS_LABELS, availableRecords, emptyUserForm, linkField, matchesUser, recordLabel, roleLabel,
  userFormErrors, userFormFromUser, userPayload,
} from "./user-form.mjs";

async function loadAccounts() {
  const [users, teachers, students] = await Promise.all([
    apiRequest("/users"), apiRequest("/teachers"), apiRequest("/students"),
  ]);
  return { users, teachers, students };
}

export default function UsersPage() {
  const { me } = useAuth();
  const [users, setUsers] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [students, setStudents] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizes[0]);
  const [form, setForm] = useState(emptyUserForm);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notification, notify] = useNotification();

  useEffect(() => {
    let active = true;
    loadAccounts()
      .then((data) => {
        if (!active) return;
        setUsers(data.users);
        setTeachers(data.teachers);
        setStudents(data.students);
        setLoadState("ready");
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error.message);
        setLoadState("error");
      });
    return () => { active = false; };
  }, []);

  const rows = users.filter((user) => matchesUser(user, search, roleFilter));
  const userPage = paginate(rows, page, pageSize);
  const field = linkField(form.role);
  const records = field === "teacher_id" ? teachers : students;
  const choices = field ? availableRecords(records, users, field, editing?.id) : [];
  const isSelf = (user) => Boolean(me?.id) && user.id === me.id;

  function openForm(user = null) {
    setEditing(user);
    setForm(user ? userFormFromUser(user) : { ...emptyUserForm });
    setErrors({});
    setFormError("");
    setFormOpen(true);
  }

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    setFormError("");
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const problems = userFormErrors(form, { editing: Boolean(editing) });
    setErrors(problems);
    if (Object.keys(problems).length) return;

    setBusy(true);
    try {
      const saved = await apiRequest(editing ? `/users/${editing.id}` : "/users", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(userPayload(form, { editing: Boolean(editing) })),
      });
      setUsers((current) => [...current.filter((user) => user.id !== saved.id), saved]
        .sort((a, b) => (a.email ?? "~").localeCompare(b.email ?? "~")));
      setFormOpen(false);
      notify(editing ? "Account updated successfully." : `Invitation sent to ${saved.email}.`, "success");
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeactivate() {
    if (busy || !deactivateTarget) return;
    setBusy(true);
    try {
      await apiRequest(`/users/${deactivateTarget.id}`, { method: "DELETE" });
      setUsers((current) => current.filter((user) => user.id !== deactivateTarget.id));
      notify(`${deactivateTarget.email ?? "The account"} can no longer log in.`, "success");
    } catch (error) {
      notify(error.message);
    } finally {
      setDeactivateTarget(null);
      setBusy(false);
    }
  }

  const fieldClass = (name) => `form-control${errors[name] ? " is-invalid" : ""}`;
  const selectClass = (name) => `form-select${errors[name] ? " is-invalid" : ""}`;
  const feedback = (name) => errors[name] && <div id={`user-${name}-error`} className="invalid-feedback d-block">{errors[name]}</div>;

  return <div className="campus-app">
    <AppNav current="/users" />
    <main className="container degrees-main py-4">
      <header className="degrees-heading mb-3">
        <p className="eyebrow mb-2">ACCESS</p>
        <h1 className="display-5 fw-semibold mb-1">Users</h1>
        <p className="text-secondary mb-0">Invite people and link each account to its teacher or student record.</p>
      </header>
      <Notification notification={notification} onClose={() => notify(null)} />

      <div className="d-flex align-items-center justify-content-between mb-3">
        <h2 className="h4 mb-0">Accounts</h2>
        <button type="button" className="btn btn-campus create-degree-button" disabled={loadState !== "ready"}
          onClick={() => openForm()}><UserPlus size={15} aria-hidden="true" /> Invite user</button>
      </div>

      <div className="room-table-panel">
        <div className="room-table-toolbar">
          <label className="catalogue-search room-search">
            <input type="search" aria-label="Search users" placeholder="Search by email or name" value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          </label>
          <select className="form-select w-auto" aria-label="Filter by role" value={roleFilter}
            onChange={(event) => { setRoleFilter(event.target.value); setPage(1); }}>
            <option value="">All roles</option>
            {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0 room-table">
            <caption className="visually-hidden">Accounts</caption>
            <thead><tr>
              {["Email", "Role", "Linked record", "Status", "Actions"].map((label) => <th scope="col" key={label}>{label}</th>)}
            </tr></thead>
            <tbody>
              {userPage.rows.map((user) => <tr key={user.id}>
                <th scope="row">{user.email ?? "Unknown email"}{isSelf(user) && <span className="text-secondary fw-normal"> (you)</span>}</th>
                <td>{roleLabel(user.role)}</td>
                <td>{user.linked_name ?? "—"}</td>
                <td>{user.status ? <span className={`semester-pill user-status user-status-${user.status}`}>{STATUS_LABELS[user.status]}</span> : "—"}</td>
                <td><div className="room-actions">
                  <button type="button" className="btn btn-edit" aria-label={`Edit ${user.email ?? "account"}`}
                    onClick={() => openForm(user)}><Pencil size={14} aria-hidden="true" /></button>
                  <button type="button" className="btn btn-delete" aria-label={`Deactivate ${user.email ?? "account"}`}
                    disabled={isSelf(user)} title={isSelf(user) ? "You cannot deactivate your own account" : undefined}
                    onClick={() => setDeactivateTarget(user)}><UserX size={14} aria-hidden="true" /></button>
                </div></td>
              </tr>)}
              {!rows.length && <tr><td colSpan="5" className="room-table-message">
                {loadState === "loading" ? "Loading accounts..." :
                  loadState === "error" ? loadError :
                  search || roleFilter ? "No matching accounts" : "No accounts yet"}
              </td></tr>}
            </tbody>
          </table>
        </div>

        {!!rows.length && <div className="room-table-footer">
          <label>Rows per page <select value={pageSize} className="form-select form-select-sm"
            onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
            {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
          </select></label>
          <p className="room-page-range" role="status">Showing {userPage.first}-{userPage.last} of {userPage.total} accounts</p>
          <div className="btn-group">
            <button type="button" className="btn btn-light" disabled={userPage.page === 1} onClick={() => setPage(userPage.page - 1)}>Previous</button>
            <button type="button" className="btn btn-light" disabled={userPage.page === userPage.pageCount} onClick={() => setPage(userPage.page + 1)}>Next</button>
          </div>
        </div>}
      </div>

      {formOpen && <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="user-form-title">
        <section className="degree-form-modal">
          <div className="degree-form-modal-header">
            <h2 id="user-form-title" className="h4 mb-0">{editing ? "Edit account" : "Invite user"}</h2>
            <button type="button" className="degree-modal-close" aria-label="Close form" disabled={busy} onClick={() => setFormOpen(false)}>×</button>
          </div>
          <form className="d-grid gap-3" onSubmit={submit} noValidate>
            {formError && <div className="alert alert-danger" role="alert">{formError}</div>}
            {editing ? <p className="mb-0"><span className="form-label d-block">Email</span>{editing.email ?? "Unknown email"}</p> : <div>
              <label className="form-label" htmlFor="user-email">Email</label>
              <input id="user-email" type="email" className={fieldClass("email")} maxLength={254} value={form.email} disabled={busy}
                aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "user-email-error" : "user-email-hint"}
                onChange={(event) => updateField("email", event.target.value)} />
              {feedback("email") || <div id="user-email-hint" className="form-text">They get an email with a link to choose their password.</div>}
            </div>}
            <div>
              <label className="form-label" htmlFor="user-role">Role</label>
              <select id="user-role" className="form-select" value={form.role} disabled={busy || (editing && isSelf(editing))}
                onChange={(event) => updateField("role", event.target.value)}>
                {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            {field && <div>
              <label className="form-label" htmlFor="user-record">{form.role === "teacher" ? "Teacher" : "Student"}</label>
              <select id="user-record" className={selectClass(field)} value={form[field]} disabled={busy}
                aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `user-${field}-error` : undefined}
                onChange={(event) => updateField(field, event.target.value)}>
                <option value="">Select {form.role}</option>
                {choices.map((record) => <option key={record.id} value={record.id}>{recordLabel(record, field)}</option>)}
              </select>
              {feedback(field)}
              {!choices.length && <div className="form-text">
                Every {form.role} already has an account. Add the {form.role} on the {form.role === "teacher" ? "Teachers" : "Students"} page first.
              </div>}
            </div>}
            <div className="degree-form-modal-actions">
              <button type="button" className="btn btn-light" disabled={busy} onClick={() => setFormOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-campus" disabled={busy}>
                {busy ? "Saving..." : editing ? "Save changes" : "Send invitation"}
              </button>
            </div>
          </form>
        </section>
      </div>}

      {deactivateTarget && <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="deactivate-user-title">
        <div className="delete-modal">
          <h3 id="deactivate-user-title" className="h5 mb-2">Deactivate account?</h3>
          <p className="delete-modal-text">
            <strong>{deactivateTarget.email ?? "This account"}</strong> will no longer be able to log in.
            {deactivateTarget.linked_name && <> The record of {deactivateTarget.linked_name} is kept.</>}
          </p>
          <div className="delete-modal-actions">
            <button type="button" className="btn btn-light" disabled={busy} onClick={() => setDeactivateTarget(null)}>Cancel</button>
            <button type="button" className="btn btn-delete btn-danger-confirm" disabled={busy} onClick={confirmDeactivate}>
              {busy ? "Deactivating..." : "Yes, deactivate"}
            </button>
          </div>
        </div>
      </div>}
    </main>
  </div>;
}
