"use client";

import { useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { getCourseColors } from "../calendar/sessions.mjs";


function CourseIdentity({ course, description }) {
  const initials = course.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  const [background, color] = getCourseColors(course.id);

  return (
    <div className="d-flex align-items-center gap-3 flex-grow-1">
      <span
        className="student-course-icon rounded-3 d-inline-flex align-items-center justify-content-center fw-semibold small flex-shrink-0"
        style={{
          "--course-background": background,
          "--course-color": color,
        }}
        aria-hidden="true"
      >
        {initials}
      </span>
      <div>
        <div className="fw-semibold text-break">
          {course.name}
        </div>
        <div className="text-secondary small">
          {description}
        </div>
      </div>
    </div>
  );
}

export default function MyCoursesPanel({
  courses = [],
  availableCourses = [],
  loading = false,
  onAdd,
  onRemove,
}) {
  const headingId = useId();
  const electiveHeadingId = useId();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const enrolledIds = new Set(
    courses.map((course) => String(course.id))
  );

  const choices = availableCourses.filter(
    (course) => !enrolledIds.has(String(course.id))
  );

  async function runOperation(operation) {
    if (pending.current || loading) return;

    pending.current = true;
    setBusy(true);
    setError("");

    try {
      await operation();
    } catch (failure) {
      setError(
        failure.message || "Could not update your courses."
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function addCourse(course) {
    if (
      typeof onAdd !== "function" ||
      enrolledIds.has(String(course.id))
    ) return;

    await runOperation(() => onAdd(course.id));
  }

  async function removeCourse(course) {
    if (
      !course.is_extra ||
      typeof onRemove !== "function"
    ) return;

    await runOperation(() => onRemove(course.id));
  }

  if (loading) {
    return (
      <p className="slot-card py-3" role="status">
        Loading your courses...
      </p>
    );
  }

  return (
    <>
      {error && (
        <div
          className="slot-card mb-3 text-danger py-2"
          role="alert"
        >
          {error}
        </div>
      )}

      <section
        className="room-table-panel mb-3"
        aria-labelledby={headingId}
      >
        <div className="room-table-toolbar">
          <div>
            <h2
              id={headingId}
              className="slot-section-title"
            >
              Your courses
            </h2>
            <p className="text-secondary small mb-0">
              Assigned courses and additional electives.
            </p>
          </div>

          <span
            className="catalogue-total"
            aria-live="polite"
          >
            {courses.length}{" "}
            {courses.length === 1 ? "course" : "courses"}
          </span>
        </div>

        <div className="px-3 pb-3">
          {courses.length ? (
            <ul className="list-unstyled mb-0">
              {courses.map((course) => (
                <li
                  key={course.id}
                  className="d-flex flex-wrap gap-2 align-items-center border-top py-3"
                >
                  <CourseIdentity
                    course={course}
                    description={
                      course.is_extra
                        ? "Additional course"
                        : "Assigned course"
                    }
                  />

                  {course.is_extra ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      aria-label={`Remove ${course.name}`}
                      disabled={
                        busy ||
                        typeof onRemove !== "function"
                      }
                      onClick={() => removeCourse(course)}
                    >
                      Remove
                    </button>
                  ) : (
                    <span className="badge bg-success-subtle text-success-emphasis">
                      Enrolled
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-secondary small mb-0">
              No assigned or extra courses.
            </p>
          )}
        </div>
      </section>

      <section
        className="room-table-panel mb-3"
        aria-labelledby={electiveHeadingId}
      >
        <div className="room-table-toolbar">
          <div>
            <h2
              id={electiveHeadingId}
              className="slot-section-title"
            >
              Elective courses
            </h2>
            <p className="text-secondary small mb-0">
              Explore courses you can add to your timetable.
            </p>
          </div>
        </div>

        <div className="px-3 pb-3">
          {choices.length ? (
            <ul className="list-unstyled mb-0">
              {choices.map((course) => (
                <li
                  key={course.id}
                  className="d-flex flex-wrap gap-2 align-items-center border-top py-3"
                >
                  <CourseIdentity
                    course={course}
                    description="Available elective"
                  />

                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-2"
                    aria-label={`Add ${course.name}`}
                    disabled={
                      busy || typeof onAdd !== "function"
                    }
                    onClick={() => addCourse(course)}
                  >
                    <Plus size={15} aria-hidden="true" />
                    Add course
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-secondary small mb-0">
              No additional courses available.
            </p>
          )}
        </div>
      </section>

      <p className="text-secondary small mt-3 mb-0">
        Assigned courses are determined by your degree
        programme and academic year.
      </p>
    </>
  );
}
