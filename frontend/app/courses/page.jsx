"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const emptyForm = {
name: "",
degree_id: "",
year_id: "",
semester_id: "",
weekly_hours: 1,
enrolled_students: 1,
requires_lab: false,
requires_projector: false,
};

async function request(path, options = {}) {
const response = await fetch(`${API}${path}`, {
...options,
headers: {
"Content-Type": "application/json",
...options.headers,
},
});

if (!response.ok) {
const body = await response.json();
const detail = Array.isArray(body.detail)
? body.detail.map((issue) => issue.msg).join(" ")
: body.detail;

throw new Error(detail || "Request failed.");

}

return response.status === 204 ? null : response.json();
}

export default function CoursesPage() {
const [degrees, setDegrees] = useState([]);
const [courses, setCourses] = useState([]);
const [form, setForm] = useState(emptyForm);
const [editingId, setEditingId] = useState(null);
const [formOpen, setFormOpen] = useState(false);
const [notification, setNotification] = useState(null);

const [filterDegree, setFilterDegree] = useState("");
const [filterYear, setFilterYear] = useState("");
const [filterSemester, setFilterSemester] = useState("");

const [formYears, setFormYears] = useState([]);
const [formSemesters, setFormSemesters] = useState([]);
const [filterYears, setFilterYears] = useState([]);
const [filterSemesters, setFilterSemesters] = useState([]);

function showNotification(text, type = "error") {
setNotification({ text, type });
}

async function refreshCourses() {
const params = new URLSearchParams();

if (filterDegree) params.set("degree_id", filterDegree);
if (filterYear) params.set("year_id", filterYear);
if (filterSemester) params.set("semester_id", filterSemester);

const query = params.toString();
const result = await request(`/courses${query ? `?${query}` : ""}`);
setCourses(result);

}

useEffect(() => {
async function loadInitialData() {
try {
const degreeList = await request("/degrees");

    const detailedDegrees = await Promise.all(
      degreeList.map((degree) => request(`/degrees/${degree.id}`))
    );

    setDegrees(detailedDegrees);
    await refreshCourses();
  } catch (error) {
    showNotification(error.message);
  }
}

loadInitialData();

}, []);

useEffect(() => {
refreshCourses().catch((error) => showNotification(error.message));
}, [filterDegree, filterYear, filterSemester]);

useEffect(() => {
if (!notification) return undefined;

const timeout = window.setTimeout(() => setNotification(null), 5000);
return () => window.clearTimeout(timeout);

}, [notification]);

function getYears(degreeId) {
return degrees.find((degree) => String(degree.id) === String(degreeId))
?.years || [];
}

function getSemesters(yearId, years) {
return years.find((year) => String(year.id) === String(yearId))
?.semesters || [];
}

function changeFormDegree(degreeId) {
const years = getYears(degreeId);

setForm({
  ...form,
  degree_id: degreeId,
  year_id: "",
  semester_id: "",
});
setFormYears(years);
setFormSemesters([]);

}

function changeFormYear(yearId) {
const semesters = getSemesters(yearId, formYears);

setForm({
  ...form,
  year_id: yearId,
  semester_id: "",
});
setFormSemesters(semesters);

}

function changeFilterDegree(degreeId) {
const years = getYears(degreeId);

setFilterDegree(degreeId);
setFilterYear("");
setFilterSemester("");
setFilterYears(years);
setFilterSemesters([]);

}

function changeFilterYear(yearId) {
const semesters = getSemesters(yearId, filterYears);

setFilterYear(yearId);
setFilterSemester("");
setFilterSemesters(semesters);

}

function openCreateForm() {
setEditingId(null);
setForm(emptyForm);
setFormYears([]);
setFormSemesters([]);
setFormOpen(true);
}

async function openEditForm(course) {
try {
const years = getYears(course.degree_id);
const semesters = getSemesters(course.year_id, years);

  setForm({
    name: course.name,
    degree_id: String(course.degree_id),
    year_id: String(course.year_id),
    semester_id: String(course.semester_id),
    weekly_hours: course.weekly_hours,
    enrolled_students: course.enrolled_students,
    requires_lab: course.requires_lab,
    requires_projector: course.requires_projector,
  });

  setFormYears(years);
  setFormSemesters(semesters);
  setEditingId(course.id);
  setFormOpen(true);
} catch (error) {
  showNotification(error.message);
}

}

function closeForm() {
setFormOpen(false);
setEditingId(null);
setForm(emptyForm);
}

async function submit(event) {
event.preventDefault();

if (!form.degree_id || !form.year_id || !form.semester_id) {
  showNotification("Please select a degree, year and semester.");
  return;
}

const body = {
  ...form,
  degree_id: Number(form.degree_id),
  year_id: Number(form.year_id),
  semester_id: Number(form.semester_id),
  weekly_hours: Number(form.weekly_hours),
  enrolled_students: Number(form.enrolled_students),
};

if (
  !Number.isInteger(body.weekly_hours) ||
  body.weekly_hours <= 0 ||
  !Number.isInteger(body.enrolled_students) ||
  body.enrolled_students <= 0
) {
  showNotification(
    "Weekly hours and enrolled students must be positive whole numbers."
  );
  return;
}

try {
  await request(
    editingId ? `/courses/${editing

