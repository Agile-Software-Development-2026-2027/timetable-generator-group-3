"use client";

import { AppNav } from "../components/app-shell.jsx";
import { useAuth } from "../components/auth-provider.jsx";
import WorkloadPreferencesForm from "../components/workload-preferences-form.jsx";

export default function MySchedulePage() {
  const auth = useAuth();
  const teacherId = auth.me?.teacher_id;

  return (
    <div className="campus-app">
      <AppNav current="/my-schedule" />

      <main className="container degrees-main py-4">
        <header className="degrees-heading mb-3">
          <p className="eyebrow mb-2">
            UNIVERSITY OF CALABRIA / TIMETABLE
          </p>
          <h1 className="display-5 fw-semibold mb-1">
            My schedule
          </h1>
          <p className="text-secondary mb-0">
            Your weekly teaching schedule and workload preferences.
          </p>
        </header>

        {/* KAN-58: Replace this placeholder with the teacher schedule. */}
        <div className="empty-calendar mb-3">
          <span className="empty-calendar-icon" aria-hidden="true">
            {"\u25A6"}
          </span>
          <span>
            <strong>Coming soon</strong>
            <small>Your weekly teaching schedule will appear here.</small>
          </span>
        </div>

        {/* KAN-72: Reusable workload preferences editor. */}
        {auth.status === "signed-in" && auth.role === "teacher" && (
          Number.isSafeInteger(teacherId) && teacherId > 0
            ? <WorkloadPreferencesForm teacherId={teacherId} />
            : <p className="text-danger small" role="alert">
                Your account is not linked to a teacher record.
              </p>
        )}
      </main>
    </div>
  );
}
