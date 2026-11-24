"use client";

import { useEffect, useRef, useState } from "react";

export default function StudentTimetableContent({
  Calendar,
  CoursesPanel,
  loadData,
  addCourse,
  removeCourse,
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

  const hasSessions = Boolean(data?.sessions?.length);
  const isPublished = data?.publication?.published === true;

  return (
    <div aria-busy={loading}>
      {error && (
        <div className="alert alert-danger" role="alert">
          <p className="mb-2">{error}</p>
          <button
            type="button"
            className="btn btn-outline-danger btn-sm"
            disabled={loading}
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      )}

      {loading && (
        <p role="status">Loading your timetable...</p>
      )}

      {data && (
        <>
          <CoursesPanel
            courses={data.courses}
            availableCourses={data.availableCourses}
            loading={loading}
            onAdd={(courseId) => updateEnrollment(addCourse, courseId)}
            onRemove={(courseId) => updateEnrollment(removeCourse, courseId)}
          />

          {!loading && (
            <>
              {!isPublished && (
                <p role="status" className="alert alert-info">
                  {hasSessions
                    ? "Your degree timetable is not published yet."
                    : "No timetable published yet."}
                </p>
              )}

              {isPublished && !hasSessions && (
                <p role="status" className="alert alert-info">
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
