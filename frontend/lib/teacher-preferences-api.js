import { apiRequest } from "./api.js";

function preferencesPath(teacherId) {
  if (!Number.isSafeInteger(teacherId) || teacherId <= 0) {
    throw new Error("Teacher ID must be a positive integer.");
  }

  return `/teachers/${teacherId}/preferences`;
}

export async function fetchTeacherPreferences(
  teacherId,
  request = apiRequest
) {
  return request(preferencesPath(teacherId));
}

export async function saveTeacherPreferences(
  teacherId,
  preferences,
  request = apiRequest
) {
  return request(preferencesPath(teacherId), {
    method: "PUT",
    body: JSON.stringify(preferences),
  });
}
