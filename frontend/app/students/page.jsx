"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api.js";
import { AppNav, Notification, useNotification } from "../components/app-shell.jsx";
import { paginate, pageSizes } from "../rooms/room-table.mjs";

const emptyForm = {
  name: "",
  student_number: "",
  degree_id: "",
  year_id: "",
};

async function loadStudentsAndDegrees() {
  const [students, summaries] = await Promise.all([
    apiRequest("/students"),
    apiRequest("/degrees"),
  ]);
  const degrees = await Promise.all(
    summaries.map((degree) => apiRequest(`/degrees/${degree.id}`))
  );
  return { students, degrees };
}

export default function StudentsPage() {
  const [students, setStudents] = useState([]);
  const [degrees, setDegrees] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [search, setSearch] = useState("");
  const [degreeFilter, setDegreeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizes[0]);
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notification, notify] = useNotification();

  useEffect(() => {
    let active = true;
    loadStudentsAndDegrees()
      .then((data) => {
        if (!active) return;
        setStudents(data.students);
        setDegrees(data.degrees);
        setLoadState("ready");
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error.message);
        setLoadState("error");
      });
    return () => { active = false; };
  }, []);

  const selectedDegree = degrees.find(
    (degree) => String(degree.id) === form.degree_id
  );
  const years = selectedDegree?.years ?? [];
  const rows = students.filter((student) =>
    `${student.name} ${student.student_number}`.toLowerCase()
      .includes(search.trim().toLowerCase()) &&
    (!degreeFilter || String(student.degree_id) === degreeFilter)
  );
  const studentPage = paginate(rows, page, pageSize);

  function openForm(student = null) {
    setEditingId(student?.id ?? null);
    setForm(student ? {
      name: student.name,
      student_number: student.student_number,
      degree_id: String(student.degree_id),
      year_id: String(student.year_id),
    } : { ...emptyForm });
    setFormError("");
    setFormOpen(true);
  }

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "degree_id" ? { year_id: "" } : {}),
    }));
    setFormError("");
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const name = form.name.trim();
    const number = form.student_number.trim();

    if (!name || !number || !selectedDegree ||
        !years.some((year) => String(year.id) === form.year_id)) {
      setFormError("Complete all fields with valid values.");
      return;
    }
    if (students.some((student) => student.id !== editingId &&
        student.student_number.toLowerCase() === number.toLowerCase())) {
      setFormError("Student number already exists.");
      return;
    }

    setBusy(true);
    try {
      const saved = await apiRequest(
        editingId ? `/students/${editingId}` : "/students", {
          method: editingId ? "PUT" : "POST",
          body: JSON.stringify({
            name, student_number: number,
            degree_id: Number(form.degree_id),
            year_id: Number(form.year_id),
          }),
        }
      );
      setStudents((current) => [
        ...current.filter((student) => student.id !== saved.id), saved,
      ].sort((a, b) => a.name.localeCompare(b.name)));
      setFormOpen(false);
      setPage(1);
      notify("Student saved successfully.", "success");
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (busy || !deleteTarget) return;
    setBusy(true);
    try {
      await apiRequest(`/students/${deleteTarget.id}`, { method: "DELETE" });
      setStudents((current) => current.filter((student) => student.id !== deleteTarget.id));
      setDeleteTarget(null);
      notify("Student deleted successfully.", "success");
    } catch (error) {
      setDeleteTarget(null);
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="campus-app">
    <AppNav current="/students" />
    <main className="container degrees-main py-4">
      <header className="degrees-heading mb-3">
        <p className="eyebrow mb-2">ACADEMIC PLANNING</p>
        <h1 className="display-5 fw-semibold mb-1">Students</h1>
        <p className="text-secondary mb-0">Manage registered student profiles.</p>
      </header>
      <Notification notification={notification} onClose={() => notify(null)} />

      <div className="d-flex align-items-center justify-content-between mb-3">
        <h2 className="h4 mb-0">Registered students</h2>
        <button type="button" className="btn btn-campus create-degree-button"
          disabled={loadState !== "ready" || !degrees.length}
          onClick={() => openForm()}>Create student</button>
      </div>

      <div className="room-table-panel">
        <div className="room-table-toolbar">
          <label className="catalogue-search room-search">
            <input type="search" aria-label="Search students"
              placeholder="Search by name or matricola" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </label>
          <select className="form-select w-auto" aria-label="Filter by degree"
            value={degreeFilter} onChange={(e) => {
              setDegreeFilter(e.target.value); setPage(1);
            }}>
            <option value="">All degrees</option>
            {degrees.map((degree) => <option key={degree.id} value={degree.id}>{degree.name}</option>)}
          </select>
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0 room-table">
            <caption className="visually-hidden">Registered students</caption>
            <thead><tr>
              {["Full name", "Matricola", "Degree", "Year", "Actions"].map(
                (label) => <th scope="col" key={label}>{label}</th>
              )}
            </tr></thead>
            <tbody>
              {studentPage.rows.map((student) => {
                const degree = degrees.find((item) => item.id === student.degree_id);
                const year = degree?.years.find((item) => item.id === student.year_id);
                return <tr key={student.id}>
                  <th scope="row">{student.name}</th>
                  <td>{student.student_number}</td>
                  <td>{degree?.name ?? "Unknown degree"}</td>
                  <td>{year?.number ?? "-"}</td>
                  <td><div className="room-actions">
                    <button type="button" className="btn btn-edit" aria-label={`Edit ${student.name}`} onClick={() => openForm(student)}><Pencil size={14} aria-hidden="true" /></button>
                    <button type="button" className="btn btn-delete" aria-label={`Delete ${student.name}`} onClick={() => setDeleteTarget(student)}><Trash2 size={14} aria-hidden="true" /></button>
                  </div></td>
                </tr>;
              })}
              {!rows.length && <tr><td colSpan="5" className="room-table-message">
                {loadState === "loading" ? "Loading students..." :
                  loadState === "error" ? loadError :
                  search || degreeFilter ? "No matching students" : "No students yet"}
              </td></tr>}
            </tbody>
          </table>
        </div>

        {!!rows.length && <div className="room-table-footer">
          <label>Rows per page <select value={pageSize} className="form-select form-select-sm"
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
          </select></label>
          <p className="room-page-range" role="status">
            Showing {studentPage.first}-{studentPage.last} of {studentPage.total} students
          </p>
          <div className="btn-group">
            <button type="button" className="btn btn-light" disabled={studentPage.page === 1} onClick={() => setPage(studentPage.page - 1)}>Previous</button>
            <button type="button" className="btn btn-light" disabled={studentPage.page === studentPage.pageCount} onClick={() => setPage(studentPage.page + 1)}>Next</button>
          </div>
        </div>}
      </div>

      {formOpen && <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="student-form-title">
        <section className="degree-form-modal">
          <div className="degree-form-modal-header">
            <h2 id="student-form-title" className="h4 mb-0">{editingId ? "Edit student" : "Create student"}</h2>
            <button type="button" className="degree-modal-close" aria-label="Close form" disabled={busy} onClick={() => setFormOpen(false)}>×</button>
          </div>
          <form className="d-grid gap-3" onSubmit={submit}>
            {formError && <div className="alert alert-danger" role="alert">{formError}</div>}
            {[["name", "Full name", 255], ["student_number", "Matricola", 32]].map(([field, label, limit]) => <div key={field}>
              <label className="form-label" htmlFor={`student-${field}`}>{label}</label>
              <input id={`student-${field}`} className="form-control" required maxLength={limit}
                value={form[field]} disabled={busy} onChange={(e) => updateField(field, e.target.value)} />
            </div>)}
            <div>
              <label className="form-label" htmlFor="student-degree">Degree programme</label>
              <select id="student-degree" className="form-select" required value={form.degree_id} disabled={busy}
                onChange={(e) => updateField("degree_id", e.target.value)}>
                <option value="">Select degree</option>
                {degrees.map((degree) => <option key={degree.id} value={degree.id}>{degree.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="student-year">Academic year</label>
              <select id="student-year" className="form-select" required value={form.year_id}
                disabled={busy || !selectedDegree} onChange={(e) => updateField("year_id", e.target.value)}>
                <option value="">Select year</option>
                {years.map((year) => <option key={year.id} value={year.id}>Year {year.number}</option>)}
              </select>
            </div>
            <div className="degree-form-modal-actions">
              <button type="button" className="btn btn-light" disabled={busy} onClick={() => setFormOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-campus" disabled={busy}>
                {busy ? "Saving..." : editingId ? "Save changes" : "Create student"}
              </button>
            </div>
          </form>
        </section>
      </div>}

      {deleteTarget && <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-student-title">
        <div className="delete-modal">
          <h3 id="delete-student-title" className="h5 mb-2">Delete student?</h3>
          <p className="delete-modal-text">This will permanently remove <strong>{deleteTarget.name}</strong> and their extra course enrollments.</p>
          <div className="delete-modal-actions">
            <button type="button" className="btn btn-light" disabled={busy} onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button type="button" className="btn btn-delete btn-danger-confirm" disabled={busy} onClick={confirmDelete}>
              {busy ? "Deleting..." : "Yes, delete"}
            </button>
          </div>
        </div>
      </div>}
    </main>
  </div>;
}
