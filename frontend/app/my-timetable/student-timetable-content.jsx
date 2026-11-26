"use client";

import { useEffect, useRef, useState } from "react";
import { AppNav } from "../components/app-shell.jsx";
import { useAuth } from "../components/auth-provider.jsx";

export default function StudentTimetableContent({
  Calendar,
  CoursesPanel,
  loadData,
  addCourse,
  removeCourse,
  view = "both",
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const mounted = useRef(false);
  const pending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const result = await loadData();
        if (active) setData(result);
      } catch (failure) {
        if (active) {
          setData(null);
          setError(failure.message || "Could not load your timetable.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [loadData, refreshKey]);

  async function updateEnrollment(operation, courseId) {
    if (pending.current) return;

    pending.current = true;

    try {
      await operation(courseId);

      if (!mounted.current) return;

      setLoading(true);
      setError("");

      try {
        const result = await loadData();
        if (mounted.current) setData(result);
      } catch {
        if (mounted.current) {
          setData(null);
          setError("Courses updated, but the timetable could not be refreshed.");
        }
      } finally {
        if (mounted.current) setLoading(false);
      }
    } finally {
      pending.current = false;
    }
  }

  const showCourses = view !== "timetable";
  const showCalendar = view !== "courses";

  const hasSessions = Boolean(data?.sessions?.length);
  const isPublished = data?.publication?.published === true;

  return (
    <div aria-busy={loading}>
      {error && (
        <div className="slot-card mb-3 py-3" role="alert">
          <p className="text-danger mb-2">{error}</p>
          <button
            type="button"
            className="btn btn-campus btn-sm"
            disabled={loading}
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      )}

      {loading && (
        <p role="status" className="slot-card mb-3 py-3 text-secondary">Loading your {view === "courses" ? "courses" : "timetable"}...</p>
      )}

      {data && (
        <>
          {showCourses && <CoursesPanel
            courses={data.courses}
            availableCourses={data.availableCourses}
            loading={loading}
            onAdd={(courseId) => updateEnrollment(addCourse, courseId)}
            onRemove={(courseId) => updateEnrollment(removeCourse, courseId)}
          />}

          {showCalendar && !loading && (
            <>
              {view === "timetable" && (
                <section
                  className="room-table-panel mb-3"
                  aria-label="Timetable publication"
                >
                  <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 p-3">
                    <div>
                      <h2 className="slot-section-title mb-1">
                        Personal timetable
                      </h2>
                      <p className="text-secondary small mb-0">
                        {data.sessions?.length ?? 0} scheduled classes
                      </p>
                    </div>
                    <span
                      className={`badge ${
                        isPublished
                          ? "bg-success-subtle text-success-emphasis"
                          : "bg-warning-subtle text-warning-emphasis"
                      }`}
                    >
                      {isPublished ? "Published" : "Unpublished"}
                    </span>
                  </div>
                </section>
              )}
              {!isPublished && (
                <p role="status" className="slot-card mb-3 py-3 text-secondary">
                  {hasSessions
                    ? "Your degree timetable is not published yet."
                    : "No timetable published yet."}
                </p>
              )}

              {isPublished && !hasSessions && (
                <p role="status" className="slot-card mb-3 py-3 text-secondary">
                  No classes are currently scheduled for your courses.
                </p>
              )}

              {(isPublished || hasSessions) && (
                <Calendar sessions={data.sessions} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}


export function StudentPage({
  current,
  title,
  description,
  view,
  ...contentProps
}) {
  const auth = useAuth();
  const accountId = auth.me?.id;

  const canAccess =
    auth.status === "signed-in" &&
    auth.role === "student" &&
    typeof accountId === "string" &&
    accountId.trim().length > 0;

  return (
    <div className="campus-app calendar-page">
      <AppNav current={current} />

      <main className="container degrees-main py-4">
        <header className="degrees-heading mb-3">
          <p className="eyebrow mb-2">
            UNIVERSITY OF CALABRIA / TIMETABLE
          </p>

          <h1 className="display-5 fw-semibold mb-1">
            {title}
          </h1>

          <p className="text-secondary mb-0">
            {description}
          </p>
        </header>

        {auth.status === "loading" ? (
          <p className="slot-card py-3" role="status">
            Checking your session...
          </p>
        ) : canAccess ? (
          <StudentTimetableContent
            {...contentProps}
            key={accountId}
            view={view}
          />
        ) : (
          <p className="slot-card py-3 text-secondary" role="status">
            A valid student account is required to view your {view === "courses" ? "courses" : "timetable"}.
          </p>
        )}
      </main>
    </div>
  );
}
