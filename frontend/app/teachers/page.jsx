"use client";

import { useEffect, useState } from "react";
import { AppNav, Notification, useNotification } from "../components/app-shell.jsx";
import { emptyTeacherForm, matches, request, teacherFormErrors, teacherFormFromTeacher, teacherPayload, toggleId } from "./teacher-form.mjs";
import { pageNumbers, pageSizes, paginate } from "../rooms/room-table.mjs";

function ActionIcon({ name }) {
  const iconPaths = {
    edit: <path d="m4 16-.8 4.8L8 20l11-11-4-4zM13.5 6.5l4 4" />,
    delete: <path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" />,
  };
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {iconPaths[name]}
    </svg>
  );
}

export default function TeachersPage() {
  const [teachers, setTeachers] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizes[0]);
  const [courseSearch, setCourseSearch] = useState("");
  const [form, setForm] = useState(emptyTeacherForm);
  const [formErrors, setFormErrors] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [viewTarget, setViewTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [notification, notify] = useNotification();

  async function refresh() {
    try {
      const [teacherRows, courseRows] = await Promise.all([request("/teachers"), request("/courses")]);
      setTeachers(teacherRows);
      setCourses(courseRows);
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      throw error;
    }
  }

  useEffect(() => { refresh().catch((error) => notify(error.message)); }, []);

  function openForm(teacher = null) {
    setEditingId(teacher?.id ?? null);
    setForm(teacher ? teacherFormFromTeacher(teacher) : emptyTeacherForm);
    setFormErrors({});
    setCourseSearch("");
    setDeleteTarget(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  function updateField(field, value) {
    setForm({ ...form, [field]: value });
    if (formErrors[field]) setFormErrors({ ...formErrors, [field]: undefined });
  }

  async function submit(event) {
    event.preventDefault();
    const errors = teacherFormErrors(form, teachers, editingId);
    setFormErrors(errors);
    if (Object.keys(errors).length) return;
    try {
      await request(editingId ? `/teachers/${editingId}` : "/teachers", {
        method: editingId ? "PUT" : "POST", body: JSON.stringify(teacherPayload(form)),
      });
      closeForm();
      notify("Teacher saved successfully.", "success");
      await refresh();
    } catch (error) { notify(error.message); }
  }

  async function confirmDelete() {
    const teacher = deleteTarget;
    setDeleteTarget(null);
    try {
      await request(`/teachers/${teacher.id}${teacher.course_count ? "?force=true" : ""}`, { method: "DELETE" });
      notify("Teacher deleted successfully.", "success");
    } catch (error) { notify(error.message); }
    await refresh().catch(() => {});
  }

  const rows = teachers.filter((t) => matches(`${t.name} ${t.identifier}`, search));
  const teacherPage = paginate(rows, page, pageSize);
  const visibleCourses = courses.filter((c) => matches(`${c.name} ${c.degree}`, courseSearch));

  return <div className="campus-app">
    <AppNav current="/teachers" />
    <main className="container degrees-main py-4">
      <header className="degrees-heading mb-3">
        <p className="eyebrow mb-2">ACADEMIC PLANNING</p>
        <h1 className="display-5 fw-semibold mb-1">Teachers</h1>
        <p className="text-secondary mb-0">Register teachers and assign them to the courses they teach.</p>
      </header>
      <Notification notification={notification} onClose={() => notify(null)} />
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h2 className="h4 mb-0">Registered teachers</h2>
        <div className="catalogue-header-actions">
          <span className="catalogue-total">{rows.length} {search.trim() ? "matching" : "total"}</span>
          <button type="button" className="btn btn-campus create-degree-button" onClick={() => openForm()}>Create teacher</button>
        </div>
      </div>
      <div className="room-table-panel">
        <div className="room-table-toolbar">
          <label className="catalogue-search room-search">
            <input type="search" placeholder="Search by name or identifier" aria-label="Search teachers" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </label>
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0 room-table">
            <caption className="visually-hidden">Registered teachers</caption>
            <thead><tr><th scope="col">Full name</th><th scope="col">Identifier</th><th scope="col" className="text-end">Courses</th><th scope="col" className="text-end">Actions</th></tr></thead>
            <tbody>
              {teacherPage.rows.map((teacher) => <tr key={teacher.id}>
                <th scope="row" className="room-code">{teacher.name}</th>
                <td>{teacher.identifier}</td>
                <td className="text-end room-number">{teacher.course_count}</td>
                <td><div className="room-actions">
                  <button type="button" className="btn btn-light" aria-label={`View courses of ${teacher.name}`} onClick={() => setViewTarget(teacher)}>Courses</button>
                  <button type="button" className="btn btn-edit" aria-label={`Edit ${teacher.name}`} onClick={() => openForm(teacher)}><ActionIcon name="edit" /><span>Edit</span></button>
                  <button type="button" className="btn btn-delete" aria-label={`Delete ${teacher.name}`} onClick={() => setDeleteTarget(teacher)}><ActionIcon name="delete" /><span>Delete</span></button>
                </div></td>
              </tr>)}
              {!rows.length && <tr><td colSpan="4" className="room-table-message">
                {loadState === "loading" && <p className="text-secondary mb-0">Loading teachers…</p>}
                {loadState === "error" && <p className="fw-semibold mb-0">Teachers could not be loaded. Check that the API is running.</p>}
                {loadState === "ready" && <p className="fw-semibold mb-0">{search.trim() ? "No teachers match your search" : "No teachers yet"}</p>}
              </td></tr>}
            </tbody>
          </table>
        </div>
        {!!rows.length && <div className="room-table-footer">
          <div className="room-page-size">
            <label className="room-filters-label" htmlFor="teacher-page-size">Rows per page</label>
            <select id="teacher-page-size" className="form-select form-select-sm table-page-size-select" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
              {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </div>
          <p className="room-page-range" role="status">Showing {teacherPage.first}–{teacherPage.last} of {teacherPage.total} {teacherPage.total === 1 ? "teacher" : "teachers"}</p>
          <nav aria-label="Teacher pages">
            <ul className="pagination pagination-sm mb-0 room-pagination">
              <li className={`page-item ${teacherPage.page === 1 ? "disabled" : ""}`}>
                <button type="button" className="page-link" disabled={teacherPage.page === 1} onClick={() => setPage(teacherPage.page - 1)}>Previous</button>
              </li>
              {pageNumbers(teacherPage.page, teacherPage.pageCount).map((number, index) => (number === null
                ? <li className="page-item disabled" key={`gap-${index}`}><span className="page-link" aria-hidden="true">…</span></li>
                : <li className={`page-item ${number === teacherPage.page ? "active" : ""}`} key={number}>
                  <button type="button" className="page-link" aria-label={`Page ${number}`} aria-current={number === teacherPage.page ? "page" : undefined} onClick={() => setPage(number)}>{number}</button>
                </li>))}
              <li className={`page-item ${teacherPage.page === teacherPage.pageCount ? "disabled" : ""}`}>
                <button type="button" className="page-link" disabled={teacherPage.page === teacherPage.pageCount} onClick={() => setPage(teacherPage.page + 1)}>Next</button>
              </li>
            </ul>
          </nav>
        </div>}
      </div>

      {formOpen && <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="teacher-form-title">
        <section className="degree-form-modal">
          <div className="degree-form-modal-header">
            <h2 id="teacher-form-title" className="h4 mb-0">{editingId ? "Edit teacher" : "Create a teacher"}</h2>
            <button type="button" className="degree-modal-close" aria-label="Close form" onClick={closeForm}>×</button>
          </div>
          <form onSubmit={submit} className="d-grid gap-3" noValidate>
            {[["name", "Full name", "e.g. Mario Rossi"], ["identifier", "Identifier (staff code or email)", "e.g. m.rossi@unical.it"]].map(([field, label, placeholder]) => <div key={field}>
              <label className="form-label" htmlFor={`teacher-${field}`}>{label}</label>
              <input id={`teacher-${field}`} className={`form-control ${formErrors[field] ? "is-invalid" : ""}`} maxLength="255" placeholder={placeholder}
                value={form[field]} aria-invalid={Boolean(formErrors[field])} onChange={(e) => updateField(field, e.target.value)} />
              {formErrors[field] && <div className="invalid-feedback">{formErrors[field]}</div>}
            </div>)}
            <fieldset>
              <legend className="form-label">Assigned courses ({form.course_ids.length})</legend>
              <input type="search" className="form-control form-control-sm mb-2" placeholder="Filter courses" aria-label="Filter courses" value={courseSearch} onChange={(e) => setCourseSearch(e.target.value)} />
              <div className="assignment-list">
                {visibleCourses.map((course) => <div className="form-check" key={course.id}>
                  <input id={`course-${course.id}`} className="form-check-input" type="checkbox" checked={form.course_ids.includes(course.id)}
                    onChange={() => updateField("course_ids", toggleId(form.course_ids, course.id))} />
                  <label className="form-check-label" htmlFor={`course-${course.id}`}>{course.name} <span className="text-secondary small">· {course.degree}</span></label>
                </div>)}
                {!visibleCourses.length && <p className="small text-secondary mb-0">No courses available.</p>}
              </div>
            </fieldset>
            <div className="degree-form-modal-actions">
              <button type="button" className="btn btn-light" onClick={closeForm}>Cancel</button>
              <button className="btn btn-campus">{editingId ? "Save changes" : "Create teacher"}</button>
            </div>
          </form>
        </section>
      </div>}

      {viewTarget && <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="teacher-view-title">
        <div className="delete-modal">
          <h3 id="teacher-view-title" className="h5 mb-1">{viewTarget.name}</h3>
          <p className="text-secondary small">{viewTarget.identifier}</p>
          {viewTarget.courses.length
            ? <ul className="mb-3">{viewTarget.courses.map((c) => <li key={c.id}>{c.name} <span className="text-secondary small">· {c.degree}</span></li>)}</ul>
            : <p className="delete-modal-text">This teacher is not assigned to any course.</p>}
          <div className="delete-modal-actions"><button type="button" className="btn btn-light" onClick={() => setViewTarget(null)}>Close</button></div>
        </div>
      </div>}

      {deleteTarget && <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-teacher-title">
        <div className="delete-modal delete-modal-wide">
          <p className="eyebrow mb-1">CONFIRM ACTION</p>
          <h3 id="delete-teacher-title" className="h5 mb-2">Delete teacher?</h3>
          <p className="delete-modal-text">This will permanently remove <strong>{deleteTarget.name}</strong>.</p>
          {deleteTarget.course_count > 0 && <p className="delete-modal-warning" role="alert">
            <strong>Warning:</strong> this teacher is assigned to {deleteTarget.course_count} {deleteTarget.course_count === 1 ? "course" : "courses"} ({deleteTarget.courses.map((c) => c.name).join(", ")}). Unassign them first, or delete anyway to remove the assignments.
          </p>}
          <div className="delete-modal-actions">
            <button type="button" className="btn btn-light" onClick={() => setDeleteTarget(null)}>No, keep it</button>
            {deleteTarget.course_count > 0 && <button type="button" className="btn btn-edit" onClick={() => openForm(deleteTarget)}>Unassign courses</button>}
            <button type="button" className="btn btn-delete btn-danger-confirm" onClick={confirmDelete}>{deleteTarget.course_count > 0 ? "Remove assignments and delete" : "Yes, delete"}</button>
          </div>
        </div>
      </div>}
    </main>
  </div>;
}
