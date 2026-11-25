import { apiRequest } from "./api.js";
import { SESSION_PAGE_SIZE } from "../app/calendar/sessions.mjs";

const STUDENT_PATH = "/students/me";

function validateCourseId(courseId) {
  if (!Number.isSafeInteger(courseId) || courseId <= 0) {
    throw new Error("Course ID must be a positive integer.");
  }
}

export async function fetchStudentCourses(request = apiRequest) {
  return request(`${STUDENT_PATH}/courses`);
}

export async function fetchAvailableCourses(request = apiRequest) {
  return request(`${STUDENT_PATH}/available-courses`);
}

export async function addExtraCourse(courseId, request = apiRequest) {
  validateCourseId(courseId);

  return request(`${STUDENT_PATH}/enrollments`, {
    method: "POST",
    body: JSON.stringify({ course_id: courseId }),
  });
}

export async function removeExtraCourse(courseId, request = apiRequest) {
  validateCourseId(courseId);

  return request(`${STUDENT_PATH}/enrollments/${courseId}`, {
    method: "DELETE",
  });
}

export async function fetchStudentPublicationStatus(request = apiRequest) {
  return request(`${STUDENT_PATH}/timetable-status`);
}

export async function fetchStudentSessions(request = apiRequest) {
  const sessions = [];

  for (let page = 1; ; page += 1) {
    const path = `${STUDENT_PATH}/timetable?page=${page}&page_size=${SESSION_PAGE_SIZE}`;
    const batch = await request(path);

    if (!Array.isArray(batch)) {
      throw new Error("Invalid student timetable response.");
    }

    sessions.push(...batch);

    if (batch.length < SESSION_PAGE_SIZE) {
      return sessions;
    }
  }
}

export async function fetchStudentTimetableData(request = apiRequest) {
  const [courses, availableCourses, sessions, publication] = await Promise.all([
    fetchStudentCourses(request),
    fetchAvailableCourses(request),
    fetchStudentSessions(request),
    fetchStudentPublicationStatus(request),
  ]);

  return { courses, availableCourses, sessions, publication };
}
