"use client";

import StudentCalendar from "./student-calendar.jsx";
import { StudentPage } from "./student-timetable-content.jsx";
import {
  fetchStudentTimetableData,
} from "../../lib/student-api.js";

export default function MyTimetablePage() {
  return (
    <StudentPage
      current="/my-timetable"
      title="My timetable"
      description="Your courses and published weekly sessions."
      view="timetable"
      Calendar={StudentCalendar}
      loadData={fetchStudentTimetableData}
    />
  );
}
