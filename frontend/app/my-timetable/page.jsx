"use client";

import { useMemo } from "react";
import { AppNav } from "../components/app-shell.jsx";
import { createStudentAccountRequest } from "../../lib/student-account-request.js";
import { useAuth } from "../components/auth-provider.jsx";
import StudentCalendar from "./student-calendar.jsx";
import MyCoursesPanel from "./my-courses-panel.jsx";
import StudentTimetableContent from "./student-timetable-content.jsx";
import {
  fetchStudentTimetableData,
  addExtraCourse,
  removeExtraCourse,
} from "../../lib/student-api.js";

export default function MyTimetablePage() {
  const auth = useAuth();

  const accountId = auth.me?.id;
  const canAccess =
    auth.status === "signed-in" &&
    auth.role === "student" &&
    typeof accountId === "string" &&
    accountId.trim().length > 0;

  const operations = useMemo(() => {
    if (!canAccess) return null;

    const request = createStudentAccountRequest(accountId);

    return {
      loadData: () => fetchStudentTimetableData(request),
      addCourse: (courseId) => addExtraCourse(courseId, request),
      removeCourse: (courseId) => removeExtraCourse(courseId, request),
    };
  }, [accountId, canAccess]);

  return (
    <div className="campus-app calendar-page">
      <AppNav current="/my-timetable" />

      <main className="container degrees-main py-4">
        <header className="degrees-heading mb-3">
          <p className="eyebrow mb-2">
            UNIVERSITY OF CALABRIA / TIMETABLE
          </p>
          <h1 className="display-5 fw-semibold mb-1">My timetable</h1>
          <p className="text-secondary mb-0">
            View your weekly classes and manage your additional courses.
          </p>
        </header>

        {auth.status === "loading" ? (
          <p className="slot-card py-3" role="status">
            Checking your session...
          </p>
        ) : canAccess ? (
          <StudentTimetableContent
            key={accountId}
            Calendar={StudentCalendar}
            CoursesPanel={MyCoursesPanel}
            loadData={operations.loadData}
            addCourse={operations.addCourse}
            removeCourse={operations.removeCourse}
          />
        ) : (
          <p className="slot-card py-3 text-secondary" role="status">
            A valid student account is required to view your timetable.
          </p>
        )}
      </main>
    </div>
  );
}
