"use client";

import { useEffect, useState } from "react";
import { AppNav, Notification, useNotification } from "../components/app-shell.jsx";
import { matches, request, teachersByCourse, toggleId } from "../teachers/teacher-form.mjs";

export default function CoursesPage() {
  const [courses, setCourses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [search, setSearch] = useState("");
  const [assignTarget, setAssignTarget] = useState(null);
  const [selected, setSelected] = useState([]);
  const [notification, notify] = useNotification();

  async function refresh() {
    try {
      const [courseRows, teacherRows] = await Promise.all([request("/courses"), request("/teachers")]);
      setCourses(courseRows);
      setTeachers(teacherRows);
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      throw error;
    }
  }

  useEffect(() => { refresh().catch((error) => notify(error.message)); }, []);

  const assigned = teachersByCourse(teachers);
  const rows = courses.filter((c) => matches(`${c.name} ${c.degree}`, search));

  function openAssign(course) {
    setAssignTarget(course);
    setSelected((assigned.get(course.id) ?? []).map((t) => t.id));
  }

  async function saveAssignment(event) {
    event.preventDefault();
    try {
      await request(`/courses/${assignTarget.id}/teachers`, { method: "PUT", body: JSON.stringify({ teacher_ids: selected }) });
      setAssignTarget(null);
      notify("Teacher assignments saved.", "success");
      await refresh();
    } catch (error) { notify(error.message); }
  }

  return <div className="campus-app">
    <AppNav current="/courses" />
    <main className="container degrees-main py-4">
      <header className="degrees-heading mb-3">
        <p className="eyebrow mb-2">ACADEMIC PLANNING</p>
        <h1 className="display-5 fw-semibold mb-1">Courses</h1>
        <p className="text-secondary mb-0">See who teaches each course and change the assigned teachers.</p>
      </header>
      <Notification notification={notification} onClose={() => notify(null)} />
      <div className="room-table-panel">
        <div className="room-table-toolbar">
          <label className="catalogue-search room-search">
            <input type="search" placeholder="Search by course or degree" aria-label="Search courses" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <span className="catalogue-total">{rows.length} {search.trim() ? "matching" : "total"}</span>
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0 room-table">
            <caption className="visually-hidden">Courses and their teachers</caption>
            <thead><tr><th scope="col">Course</th><th scope="col">Degree</th><th scope="col">Teachers</th><th scope="col" className="text-end">Actions</th></tr></thead>
            <tbody>
              {rows.map((course) => {
                const courseTeachers = assigned.get(course.id) ?? [];
                return <tr key={course.id}>
                  <th scope="row" className="room-code">{course.name}</th>
                  <td>{course.degree}</td>
                  <td><div className="room-features">
                    {courseTeachers.map((t) => <span className="semester-pill" key={t.id} title={t.identifier}>{t.name}</span>)}
                    {!courseTeachers.length && <span className="small text-secondary">No teacher assigned</span>}
                  </div></td>
                  <td><div className="room-actions">
                    <button type="button" className="btn btn-edit" aria-label={`Assign teachers to ${course.name}`} onClick={() => openAssign(course)}>Assign teachers</button>
                  </div></td>
                </tr>;
              })}
              {!rows.length && <tr><td colSpan="4" className="room-table-message">
                {loadState === "loading" && <p className="text-secondary mb-0">Loading courses…</p>}
                {loadState === "error" && <p className="fw-semibold mb-0">Courses could not be loaded. Check that the API is running.</p>}
                {loadState === "ready" && <p className="fw-semibold mb-0">{search.trim() ? "No courses match your search" : "No courses yet"}</p>}
              </td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {assignTarget && <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="assign-title">
        <section className="degree-form-modal">
          <div className="degree-form-modal-header">
            <div>
              <p className="eyebrow mb-1">ASSIGN TEACHERS</p>
              <h2 id="assign-title" className="h4 mb-0">{assignTarget.name}</h2>
            </div>
            <button type="button" className="degree-modal-close" aria-label="Close form" onClick={() => setAssignTarget(null)}>×</button>
          </div>
          <form onSubmit={saveAssignment} className="d-grid gap-3">
            <div className="assignment-list">
              {teachers.map((teacher) => <div className="form-check" key={teacher.id}>
                <input id={`teacher-${teacher.id}`} className="form-check-input" type="checkbox" checked={selected.includes(teacher.id)}
                  onChange={() => setSelected(toggleId(selected, teacher.id))} />
                <label className="form-check-label" htmlFor={`teacher-${teacher.id}`}>{teacher.name} <span className="text-secondary small">· {teacher.identifier}</span></label>
              </div>)}
              {!teachers.length && <p className="small text-secondary mb-0">No teachers registered yet. Create one on the Teachers page.</p>}
            </div>
            <div className="degree-form-modal-actions">
              <button type="button" className="btn btn-light" onClick={() => setAssignTarget(null)}>Cancel</button>
              <button className="btn btn-campus">Save assignments</button>
            </div>
          </form>
        </section>
      </div>}
    </main>
  </div>;
}
