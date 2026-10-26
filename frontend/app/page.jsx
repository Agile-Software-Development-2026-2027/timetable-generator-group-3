"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const emptyForm = { name: "", years: 3, semesters_per_year: 2 };

function ActionIcon({ name }) {
  const iconPaths = {
    add: <><path d="M12 5v14M5 12h14" /></>,
    edit: <><path d="m4 16-.8 4.8L8 20l11-11-4-4zM13.5 6.5l4 4" /></>,
    delete: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
  };
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{iconPaths[name]}</svg>;
}

export default function DegreesPage() {
  const [degrees, setDegrees] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [notification, setNotification] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  function showNotification(text, type = "error") {
    setNotification({ text, type });
  }

  useEffect(() => {
    if (!notification) return undefined;
    const timeout = window.setTimeout(() => setNotification(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notification]);

  async function request(path, options) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
    if (!response.ok) {
      const body = await response.json();
      const detail = Array.isArray(body.detail)
        ? body.detail.map((issue) => issue.msg).join(" ")
        : body.detail;
      throw new Error(detail || "Request failed.");
    }
    return response.status === 204 ? null : response.json();
  }

  async function refresh(selectedId = selected?.id) {
    setDegrees(await request("/degrees"));
    if (selectedId) setSelected(await request(`/degrees/${selectedId}`));
  }

  useEffect(() => { refresh().catch((error) => showNotification(error.message)); }, []);

  async function submit(event) {
    event.preventDefault();
    try {
      const degree = await request(editing ? `/degrees/${selected.id}` : "/degrees", {
        method: editing ? "PUT" : "POST", body: JSON.stringify(form),
      });
      setSelected(degree);
      setEditing(false);
      setFormOpen(false);
      setForm(emptyForm);
      showNotification("Degree saved successfully.", "success");
      await refresh(degree.id);
    } catch (error) { showNotification(error.message); }
  }

  async function confirmDeleteSelected() {
    if (!deleteTarget?.id) return;
    const degree = deleteTarget;
    try {
      await request(`/degrees/${degree.id}`, { method: "DELETE" });
    } catch (error) {
      setDeleteTarget(null);
      showNotification(error.message);
      return;
    }

    setSelected((current) => (current?.id === degree.id ? null : current));
    if (selected?.id === degree.id) {
      setEditing(false);
      setForm(emptyForm);
    }
    setDeleteTarget(null);

    try {
      await refresh(null);
      showNotification("Degree deleted successfully.", "success");
    } catch (error) {
      showNotification(`Degree deleted, but the catalogue could not refresh. ${error.message}`);
    }
  }

  function openDeleteConfirm(degree) {
    setDeleteTarget(degree);
  }

  function closeDeleteConfirm() {
    setDeleteTarget(null);
  }

  async function editSelected(degree = selected) {
    if (!degree?.id) return;
    try {
      const fullDegree = await request(`/degrees/${degree.id}`);
      setSelected(fullDegree);
      setForm({
        name: fullDegree.name,
        years: fullDegree.years.length,
        semesters_per_year: fullDegree.years[0]?.semesters.length || 2,
      });
      setEditing(true);
      setFormOpen(true);
    } catch (error) { showNotification(error.message); }
  }

  function cancelEdit() {
    setEditing(false);
    setFormOpen(false);
    setForm(emptyForm);
  }

  function openCreateForm() {
    setEditing(false);
    setForm(emptyForm);
    setFormOpen(true);
  }

  async function toggleDegreeDetails(degree) {
    if (selected?.id === degree.id) {
      setSelected(null);
      return;
    }
    try {
      setSelected(await request(`/degrees/${degree.id}`));
    } catch (error) {
      showNotification(error.message);
    }
  }

  return <div className="campus-app">
    <nav className="navbar campus-nav">
      <div className="container"><Link className="navbar-brand" href="/">UNICAL <span>UNIVERSITY OF CALABRIA</span></Link>
        <Link className="btn btn-outline-light btn-sm" href="/calendar">Open timetable</Link>
      </div>
    </nav>
    <main className="container degrees-main py-4">
      <header className="degrees-heading mb-3">
        <p className="eyebrow mb-2">ACADEMIC PLANNING</p>
        <div className="page-title-row">
          <h1 className="display-5 fw-semibold mb-1">Timetable generator</h1>
        </div>
        <p className="text-secondary mb-0">Manage degree programmes and academic structures.</p>
      </header>
      {notification && <div className={`app-notification app-notification-${notification.type}`} role={notification.type === "error" ? "alert" : "status"} aria-live="polite">
        <span className="notification-icon" aria-hidden="true">{notification.type === "success" ? "✓" : "!"}</span>
        <p className="notification-text">{notification.text}</p>
        <button type="button" className="notification-close" aria-label="Dismiss notification" onClick={() => setNotification(null)}>×</button>
      </div>}
      <div className="row g-4 align-items-start">
        <section className="col-12">
          <div className="d-flex align-items-center justify-content-between mb-3">
            <h2 className="h4 mb-0">Degree programmes</h2>
            <div className="catalogue-header-actions">
              <span className="catalogue-total">{degrees.length} total</span>
              <button type="button" className="btn btn-campus create-degree-button" onClick={openCreateForm}><ActionIcon name="add" /><span>Create degree</span></button>
            </div>
          </div>
          <div className="d-grid gap-3">
            {degrees.map((degree) => (
              <div className={`card degree-card ${selected?.id === degree.id ? "is-selected" : ""}`} key={degree.id}>
                <div className="card-body degree-card-body">
                  <button type="button" className="degree-card-main text-start" aria-expanded={selected?.id === degree.id} onClick={() => toggleDegreeDetails(degree)}>
                    <div className="degree-code">Programme</div>
                    <div className="degree-name">{degree.name}</div>
                    <div className="degree-meta">
                      <span className="degree-stat"><strong>{degree.years}</strong><small>Years</small></span>
                      <span className="degree-stat"><strong>{degree.courses}</strong><small>Courses</small></span>
                    </div>
                  </button>
                  <div className="degree-actions">
                    <button type="button" className="btn btn-edit" onClick={() => editSelected(degree)}><ActionIcon name="edit" /><span>Edit</span></button>
                    <button type="button" className="btn btn-delete" onClick={() => openDeleteConfirm(degree)}><ActionIcon name="delete" /><span>Delete</span></button>
                  </div>
                </div>
                {selected?.id === degree.id && <div className="degree-details-inline">
                  <p className="eyebrow mb-2">PROGRAMME STRUCTURE</p>
                  <div className="degree-years-inline">
                    {selected.years.map((year) => <div className="degree-year-inline" key={year.id}>
                      <span className="degree-year-label">Year {year.number}</span>
                      <div className="degree-year-semesters">
                        {year.semesters.map((semester) => <span className="semester-pill" key={semester.id}>Semester {semester.number}</span>)}
                      </div>
                    </div>)}
                  </div>
                </div>}
              </div>
            ))}
            {!degrees.length && <div className="empty-state text-center p-5"><span className="display-6">＋</span><p className="fw-semibold mt-2 mb-1">Your catalogue is ready</p><p className="text-secondary small mb-0">Create a degree to get started.</p></div>}
          </div>
        </section>
      </div>
      {formOpen && <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="degree-form-title" onMouseDown={(event) => { if (event.target === event.currentTarget) cancelEdit(); }}>
        <section className="degree-form-modal">
          <div className="degree-form-modal-header">
            <div>
              <p className="eyebrow mb-1">{editing ? "UPDATE PROGRAMME" : "GET STARTED"}</p>
              <h2 id="degree-form-title" className="h4 mb-0">{editing ? "Edit degree" : "Create a degree"}</h2>
            </div>
            <button type="button" className="degree-modal-close" aria-label="Close form" onClick={cancelEdit}>×</button>
          </div>
          <form onSubmit={submit} className="d-grid gap-3">
            <div>
              <label className="form-label" htmlFor="degree-name">Degree name</label>
              <input id="degree-name" className="form-control" placeholder="e.g. Computer Science" required maxLength="255" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="row g-3">
              <div className="col-6">
                <label className="form-label" htmlFor="degree-years">Academic years</label>
                <input id="degree-years" className="form-control" required type="number" min="1" max="6" value={form.years}
                  onChange={(e) => setForm({ ...form, years: Number(e.target.value) })} />
              </div>
              <div className="col-6">
                <label className="form-label" htmlFor="degree-semesters">Semesters / year</label>
                <input id="degree-semesters" className="form-control" required type="number" min="1" max="6" value={form.semesters_per_year}
                  onChange={(e) => setForm({ ...form, semesters_per_year: Number(e.target.value) })} />
                <div className="semester-preview" aria-live="polite">
                  <span className="small text-secondary">Each year will include</span>
                  <div className="semester-preview-pills">
                    {Array.from({ length: form.semesters_per_year }, (_, index) => <span className="semester-pill" key={index}>Semester {index + 1}</span>)}
                  </div>
                </div>
              </div>
            </div>
            <div className="degree-form-modal-actions">
              <button type="button" className="btn btn-light" onClick={cancelEdit}>Cancel</button>
              <button className="btn btn-campus">{editing ? "Save changes" : "Create degree"}</button>
            </div>
          </form>
        </section>
      </div>}
      {deleteTarget && <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-degree-title">
        <div className="delete-modal">
          <div className="delete-modal-header">
              <p className="eyebrow mb-1">CONFIRM ACTION</p>
              <h3 id="delete-degree-title" className="h5 mb-0">Delete degree?</h3>
          </div>
          <p className="delete-modal-text">This will permanently remove <strong>{deleteTarget.name}</strong> from the catalogue.</p>
          <div className="delete-modal-actions">
              <button type="button" className="btn btn-light" onClick={closeDeleteConfirm}>No, keep it</button>
              <button type="button" className="btn btn-delete btn-danger-confirm" onClick={confirmDeleteSelected}>Yes, delete</button>
          </div>
        </div>
      </div>}
    </main>
  </div>;
}
