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
    <section className="room-table-panel mb-3" aria-labelledby={headingId}>
      <div className="room-table-toolbar">
        <div>
          <h2 id={headingId} className="slot-section-title">My courses</h2>
          <p className="text-secondary small mb-0">
            View your assigned courses and manage additional electives.
          </p>
        </div>
        <span className="catalogue-total" aria-live="polite">
          {courses.length} {courses.length === 1 ? "course" : "courses"}
        </span>
      </div>

      <div className="px-3 pb-3">
        {error && (
          <div className="slot-card mb-3 text-danger py-2" role="alert">
            {error}
          </div>
        )}

        {loading && (
          <p className="slot-card py-2 mb-0" role="status">
            Loading your courses...
          </p>
        )}

        {!loading && <>
          <section className="slot-section pt-0">
            <h3 className="slot-section-title">Assigned courses</h3>
            {derivedCourses.length ? (
              <ul className="list-unstyled mb-0">
                {derivedCourses.map((course) => (
                  <li key={course.id}
                    className="d-flex flex-wrap gap-2 justify-content-between align-items-center border-bottom py-2">
                    <span className="fw-semibold text-break">{course.name}</span>
                    <span className="catalogue-total">Assigned</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-secondary small mb-0">No assigned courses.</p>
            )}
          </section>

          <section className="slot-section">
            <h3 className="slot-section-title">Extra courses</h3>
            {extraCourses.length ? (
              <ul className="list-unstyled mb-0">
                {extraCourses.map((course) => (
                  <li key={course.id}
                    className="d-flex flex-wrap gap-2 justify-content-between align-items-center border-bottom py-2">
                    <span className="fw-semibold text-break">{course.name}</span>
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
            ) : (
              <p className="text-secondary small mb-0">No extra courses added.</p>
            )}
          </section>

          <form className="slot-section border-0 pb-0" onSubmit={addCourse}>
            <label htmlFor={selectId} className="slot-section-title mb-2">
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
      </div>
    </section>
  );
}
