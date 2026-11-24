"use client";

import { useId, useRef, useState } from "react";

export default function MyCoursesPanel({
  courses = [],
  availableCourses = [],
  loading = false,
  onAdd,
  onRemove,
}) {
  const selectId = useId();
  const headingId = useId();
  const pending = useRef(false);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const enrolledIds = new Set(courses.map((course) => String(course.id)));
  const derivedCourses = courses.filter((course) => !course.is_extra);
  const extraCourses = courses.filter((course) => course.is_extra);

  const choices = availableCourses.filter(
    (course) => !enrolledIds.has(String(course.id))
  );
  const selectedCourse = choices.find(
    (course) => String(course.id) === selectedId
  );

  async function runOperation(operation) {
    if (pending.current || loading) return;

    pending.current = true;
    setBusy(true);
    setError("");

    try {
      await operation();
    } catch (failure) {
      setError(failure.message || "Could not update your courses.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function addCourse(event) {
    event.preventDefault();
    if (!selectedCourse || typeof onAdd !== "function") return;

    await runOperation(async () => {
      await onAdd(selectedCourse.id);
      setSelectedId("");
    });
  }

  async function removeCourse(course) {
    if (!course.is_extra || typeof onRemove !== "function") return;
    await runOperation(() => onRemove(course.id));
  }

  return (
    <section className="card campus-card p-3 mb-3" aria-labelledby={headingId}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h2 id={headingId} className="h5 mb-1">My courses</h2>
          <p className="text-secondary mb-0">
            View your assigned courses and manage additional electives.
          </p>
        </div>
        <span className="text-secondary" aria-live="polite">
          {courses.length} {courses.length === 1 ? "course" : "courses"}
        </span>
      </div>

      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {loading && <p role="status">Loading your courses...</p>}

      {!loading && <>
        <h3 className="h6">Assigned courses</h3>
        {derivedCourses.length ? (
          <ul className="list-group mb-3">
            {derivedCourses.map((course) => (
              <li key={course.id}
                className="list-group-item d-flex justify-content-between align-items-center">
                <span>{course.name}</span>
                <span className="badge text-bg-light">Assigned</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-secondary">No assigned courses.</p>}

        <h3 className="h6">Extra courses</h3>
        {extraCourses.length ? (
          <ul className="list-group mb-3">
            {extraCourses.map((course) => (
              <li key={course.id}
                className="list-group-item d-flex justify-content-between align-items-center">
                <span>{course.name}</span>
                <button type="button"
                  className="btn btn-sm btn-outline-danger"
                  aria-label={`Remove ${course.name}`}
                  disabled={busy || typeof onRemove !== "function"}
                  onClick={() => removeCourse(course)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="text-secondary">No extra courses added.</p>}

        <form onSubmit={addCourse}>
          <label htmlFor={selectId} className="form-label">
            Add an extra course
          </label>
          <div className="d-flex gap-2 flex-wrap">
            <select id={selectId} className="form-select flex-fill w-auto"
              value={selectedCourse ? selectedId : ""}
              disabled={busy || !choices.length || typeof onAdd !== "function"}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setError("");
              }}>
              <option value="">Select a course</option>
              {choices.map((course) => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </select>
            <button type="submit" className="btn btn-campus"
              disabled={busy || !selectedCourse || typeof onAdd !== "function"}>
              Add course
            </button>
          </div>
          {!choices.length && (
            <p className="text-secondary small mt-2 mb-0">
              No additional courses available.
            </p>
          )}
        </form>
      </>}
      <p className="text-secondary small mt-3 mb-0">
        Assigned courses are determined by your degree programme and academic year.
      </p>
    </section>
  );
}
