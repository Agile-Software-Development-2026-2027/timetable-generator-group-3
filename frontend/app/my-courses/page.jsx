"use client";

import MyCoursesPanel from "../my-timetable/my-courses-panel.jsx";
import { StudentPage } from "../my-timetable/student-timetable-content.jsx";
import {
  fetchStudentCourses,
  fetchAvailableCourses,
  addExtraCourse,
  removeExtraCourse,
} from "../../lib/student-api.js";

async function loadCourses() {
  const [courses, availableCourses] = await Promise.all([
    fetchStudentCourses(),
    fetchAvailableCourses(),
  ]);

  return { courses, availableCourses };
}

export default function MyCoursesPage() {
  return (
    <StudentPage
      current="/my-courses"
      title="My courses"
      description="Your enrolled courses and available electives."
      view="courses"
      CoursesPanel={MyCoursesPanel}
      loadData={loadCourses}
      addCourse={addExtraCourse}
      removeCourse={removeExtraCourse}
    />
  );
}
