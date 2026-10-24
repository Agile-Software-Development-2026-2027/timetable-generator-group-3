"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const emptyForm = { name: "", years: 3, semesters_per_year: 2 };

export default function DegreesPage() {
  const [degrees, setDegrees] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");

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

  useEffect(() => { refresh().catch((error) => setMessage(error.message)); }, []);

  async function submit(event) {
    event.preventDefault();
    try {
      const degree = await request(editing ? `/degrees/${selected.id}` : "/degrees", {
        method: editing ? "PUT" : "POST", body: JSON.stringify(form),
      });
      setSelected(degree);
      setEditing(false);
      setForm(emptyForm);
      setMessage("Degree saved.");
      await refresh(degree.id);
    } catch (error) { setMessage(error.message); }
  }

  async function remove() {
    try {
      await request(`/degrees/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      setEditing(false);
      setForm(emptyForm);
      setMessage("Degree deleted.");
      await refresh(null);
    } catch (error) { setMessage(error.message); }
  }

  function edit() {
    setForm({
      name: selected.name,
      years: selected.years.length,
      semesters_per_year: selected.years[0]?.semesters.length || 2,
    });
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setForm(emptyForm);
  }

  return <div className="campus-app">
    <nav className="navbar campus-nav">
      <div className="container"><Link className="navbar-brand" href="/">UNICAL <span>UNIVERSITY OF CALABRIA</span></Link>
        <Link className="btn btn-outline-light btn-sm" href="/calendar">Open timetable</Link>
      </div>
    </nav>
    <main className="container py-5">
      <header className="mb-4">
        <p className="eyebrow mb-2">UNIVERSITY OF CALABRIA / ACADEMIC PLANNING</p>
        <h1 className="display-5 fw-semibold mb-2">Timetable generator</h1>
        <p className="text-secondary mb-0">Set up degree programmes and academic structures for timetable planning.</p>
      </header>
      {message && <div className={`alert ${message.includes("saved") || message.includes("deleted") ? "alert-success" : "alert-warning"}`} role="status">{message}</div>}
      <div className="row g-4 align-items-start">
        <section className="col-lg-5">
          <div className="card campus-card h-100"><div className="card-body p-4">
            <p className="eyebrow">{editing ? "UPDATE PROGRAMME" : "GET STARTED"}</p>
            <h2 className="h4 mb-4">{editing ? "Edit degree" : "Create a degree"}</h2>
            <form onSubmit={submit} className="d-grid gap-3">
              <div><label className="form-label" htmlFor="degree-name">Degree name</label>
                <input id="degree-name" className="form-control" placeholder="e.g. Computer Science" required maxLength="255" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="row g-3">
                <div className={editing ? "col-12" : "col-6"}><label className="form-label" htmlFor="degree-years">Academic years</label>
                  <input id="degree-years" className="form-control" required type="number" min="1" max="6" value={form.years}
                    onChange={(e) => setForm({ ...form, years: Number(e.target.value) })} /></div>
                {!editing && <div className="col-6"><label className="form-label" htmlFor="degree-semesters">Semesters / year</label>
                  <input id="degree-semesters" className="form-control" required type="number" min="1" max="6" value={form.semesters_per_year}
                    onChange={(e) => setForm({ ...form, semesters_per_year: Number(e.target.value) })} /></div>}
              </div>
              <div className="d-flex gap-2 pt-2">
                <button className="btn btn-campus">{editing ? "Save changes" : "Create degree"}</button>
                {editing && <button className="btn btn-light" type="button" onClick={cancelEdit}>Cancel</button>}
              </div>
            </form>
          </div></div>
        </section>
        <section className="col-lg-7">
          <div className="d-flex align-items-center justify-content-between mb-3">
            <div><p className="eyebrow mb-1">UNIVERSITY CATALOGUE</p><h2 className="h4 mb-0">Degree programmes</h2></div>
            <span className="badge rounded-pill text-bg-light">{degrees.length} total</span>
          </div>
          <div className="d-grid gap-2">
            {degrees.map((degree) => <button className={`card degree-card text-start ${selected?.id === degree.id ? "is-selected" : ""}`} key={degree.id}
              onClick={() => request(`/degrees/${degree.id}`).then(setSelected).catch((e) => setMessage(e.message))}>
              <span className="card-body d-flex align-items-center justify-content-between gap-3">
                <span><span className="d-block fw-semibold">{degree.name}</span><span className="small text-secondary">Degree programme</span></span>
                <span className="d-flex gap-3 text-nowrap"><span><strong>{degree.years}</strong><span className="small text-secondary d-block">YEARS</span></span>
                  <span><strong>{degree.courses}</strong><span className="small text-secondary d-block">COURSES</span></span></span>
              </span>
            </button>)}
            {!degrees.length && <div className="empty-state text-center p-5"><span className="display-6">＋</span><p className="fw-semibold mt-2 mb-1">Your catalogue is ready</p><p className="text-secondary small mb-0">Create a degree to get started.</p></div>}
          </div>
        </section>
      </div>
      {selected && <section className="card campus-card mt-4"><div className="card-body p-4">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
          <div><p className="eyebrow mb-1">PROGRAMME STRUCTURE</p><h2 className="h4 mb-0">{selected.name}</h2></div>
          <div className="d-flex gap-2"><button className="btn btn-outline-secondary btn-sm" onClick={edit}>Edit degree</button>
            <button className="btn btn-outline-danger btn-sm" onClick={remove}>Delete</button></div>
        </div>
        <div className="row g-3">{selected.years.map((year) => <div className="col-sm-6 col-lg-4" key={year.id}>
          <div className="year-card p-3 h-100"><p className="eyebrow mb-2">YEAR {String(year.number).padStart(2, "0")}</p>
            {year.semesters.map((semester) => <span className="semester-pill" key={semester.id}>Semester {semester.number}</span>)}
          </div>
        </div>)}</div>
      </div></section>}
    </main>
  </div>;
}
