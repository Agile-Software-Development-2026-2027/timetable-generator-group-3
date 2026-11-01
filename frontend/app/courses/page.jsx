"use client";

import { useCallback, useEffect, useState } from "react";

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
    let detail = "Request failed.";

    try {
      const body = await response.json();
      detail = Array.isArray(body.detail)
        ? body.detail.map((issue) => issue.msg).join(" ")
        : body.detail || detail;
    } catch {
      // Keep the default error message.
    }

    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }

  return response.status === 204 ? null : response.json();
}

export default function CoursesPage() {
  const [degrees, setDegrees] = useState([]);
  const [courses, setCourses] = useState([]);
  const [form, setForm] = useState({ ...emptyForm });
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

  const refreshCourses = useCallback(async () => {
    const params = new URLSearchParams();

    if (filterDegree) params.set("degree_id", filterDegree);
    if (filterYear) params.set("year_id", filterYear);
    if (filterSemester) params.set("semester_id", filterSemester);

    const query = params.toString();
    const result = await request(`/courses${query ? `?${query}` : ""}`);

    setCourses(result);
  }, [filterDegree, filterYear, filterSemester]);

  useEffect(() => {
    async function loadDegrees() {
      try {
        const degreeList = await request("/degrees");

        const detailedDegrees = await Promise.all(
          degreeList.map((degree) => request(`/degrees/${degree.id}`))
        );

        setDegrees(detailedDegrees);
      } catch (error) {
        showNotification(error.message);
      }
    }

    loadDegrees();
  }, []);

  useEffect(() => {
    refreshCourses().catch((error) => showNotification(error.message));
  }, [refreshCourses]);

  useEffect(() => {
    if (!notification) return undefined;

    const timeout = window.setTimeout(() => setNotification(null), 5000);

    return () => window.clearTimeout(timeout);
  }, [notification]);

  function getYears(degreeId) {
    return (
      degrees.find((degree) => String(degree.id) === String(degreeId))
        ?.years || []
    );
  }

  function getSemesters(yearId, years) {
    return (
      years.find((year) => String(year.id) === String(yearId))?.semesters || []
    );
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
    setForm({ ...emptyForm });
    setFormYears([]);
    setFormSemesters([]);
    setFormOpen(true);
  }

  function openEditForm(course) {
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
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm({ ...emptyForm });
  }

  async function submit(event) {
    event.preventDefault();

    if (!form.degree_id || !form.year_id || !form.semester_id) {
      showNotification("Please select a degree, year and semester.");
      return;
    }

    const body = {
      ...form,
      name: form.name.trim(),
      degree_id: Number(form.degree_id),
      year_id: Number(form.year_id),
      semester_id: Number(form.semester_id),
      weekly_hours: Number(form.weekly_hours),
      enrolled_students: Number(form.enrolled_students),
    };

    if (!body.name) {
      showNotification("Course name is required.");
      return;
    }

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
        editingId ? `/courses/${editingId}` : "/courses",
        {
          method: editingId ? "PUT" : "POST",
          body: JSON.stringify(body),
        }
      );

      showNotification(
        editingId
          ? "Course updated successfully."
          : "Course created successfully.",
        "success"
      );

      closeForm();
      await refreshCourses();
    } catch (error) {
      showNotification(error.message);
    }
  }

  async function deleteCourse(course) {
    const confirmed = window.confirm(
      `Are you sure you want to delete the course "${course.name}"?`
    );

    if (!confirmed) return;

    try {
      await request(`/courses/${course.id}`, { method: "DELETE" });

      showNotification("Course deleted successfully.", "success");
      await refreshCourses();
    } catch (error) {
      if (error.status === 409) {
        const forceConfirmed = window.confirm(
          `${error.message}\n\nDo you want to delete the course and its saved timetable sessions anyway?`
        );

        if (!forceConfirmed) return;

        try {
          await request(`/courses/${course.id}?force=true`, {
            method: "DELETE",
          });

          showNotification(
            "Course and its timetable sessions deleted.",
            "success"
          );

          await refreshCourses();
        } catch (forceError) {
          showNotification(forceError.message);
        }
      } else {
        showNotification(error.message);
      }
    }
  }

  return (
    <main>
      <header>
        <div>
          <h1>Manage Courses</h1>
          <p>Create, edit, filter and delete courses.</p>
        </div>

        <button type="button" onClick={openCreateForm}>
          Add course
        </button>
      </header>

      {notification && (
        <div
          role="alert"
          className={`notification ${notification.type}`}
        >
          {notification.text}
        </div>
      )}

      <section className="filters">
        <h2>Filter courses</h2>

        <label>
          Degree
          <select
            value={filterDegree}
            onChange={(event) => changeFilterDegree(event.target.value)}
          >
            <option value="">All degrees</option>
            {degrees.map((degree) => (
              <option key={degree.id} value={degree.id}>
                {degree.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Year
          <select
            value={filterYear}
            onChange={(event) => changeFilterYear(event.target.value)}
            disabled={!filterDegree}
          >
            <option value="">All years</option>
            {filterYears.map((year) => (
              <option key={year.id} value={year.id}>
                Year {year.number}
              </option>
            ))}
          </select>
        </label>

        <label>
          Semester
          <select
            value={filterSemester}
            onChange={(event) => setFilterSemester(event.target.value)}
            disabled={!filterYear}
          >
            <option value="">All semesters</option>
            {filterSemesters.map((semester) => (
              <option key={semester.id} value={semester.id}>
                Semester {semester.number}
              </option>
            ))}
          </select>
        </label>
      </section>

      {formOpen && (
        <section className="course-form">
          <h2>{editingId ? "Edit course" : "Create course"}</h2>

          <form onSubmit={submit}>
            <label>
              Course name
              <input
                type="text"
                value={form.name}
                maxLength={255}
                required
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </label>

            <label>
              Degree
              <select
                value={form.degree_id}
                required
                onChange={(event) => changeFormDegree(event.target.value)}
              >
                <option value="">Select a degree</option>
                {degrees.map((degree) => (
                  <option key={degree.id} value={degree.id}>
                    {degree.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Year
              <select
                value={form.year_id}
                required
                disabled={!form.degree_id}
                onChange={(event) => changeFormYear(event.target.value)}
              >
                <option value="">Select a year</option>
                {formYears.map((year) => (
                  <option key={year.id} value={year.id}>
                    Year {year.number}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Semester
              <select
                value={form.semester_id}
                required
                disabled={!form.year_id}
                onChange={(event) =>
                  setForm({ ...form, semester_id: event.target.value })
                }
              >
                <option value="">Select a semester</option>
                {formSemesters.map((semester) => (
                  <option key={semester.id} value={semester.id}>
                    Semester {semester.number}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Required weekly hours
              <input
                type="number"
                min="1"
                step="1"
                required
                value={form.weekly_hours}
                onChange={(event) =>
                  setForm({ ...form, weekly_hours: event.target.value })
                }
              />
            </label>

            <label>
              Estimated enrolled students
              <input
                type="number"
                min="1"
                step="1"
                required
                value={form.enrolled_students}
                onChange={(event) =>
                  setForm({
                    ...form,
                    enrolled_students: event.target.value,
                  })
                }
              />
            </label>

            <fieldset>
              <legend>Special requirements</legend>

              <label>
                <input
                  type="checkbox"
                  checked={form.requires_lab}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      requires_lab: event.target.checked,
                    })
                  }
                />
                Requires lab / PCs
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={form.requires_projector}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      requires_projector: event.target.checked,
                    })
                  }
                />
                Requires projector
              </label>
            </fieldset>

            <div className="form-actions">
              <button type="submit">
                {editingId ? "Save changes" : "Create course"}
              </button>

              <button type="button" onClick={closeForm}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="course-list">
        <h2>Courses</h2>

        {courses.length === 0 ? (
          <p>No courses found.</p>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Degree</th>
                  <th>Year</th>
                  <th>Semester</th>
                  <th>Weekly hours</th>
                  <th>Students</th>
                  <th>Requirements</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {courses.map((course) => {
                  const requirements = [];

                  if (course.requires_lab) {
                    requirements.push("Lab / PCs");
                  }

                  if (course.requires_projector) {
                    requirements.push("Projector");
                  }

                  return (
                    <tr key={course.id}>
                      <td>{course.name}</td>
                      <td>{course.degree}</td>
                      <td>{course.year}</td>
                      <td>{course.semester}</td>
                      <td>{course.weekly_hours}</td>
                      <td>{course.enrolled_students}</td>
                      <td>
                        {requirements.length > 0
                          ? requirements.join(", ")
                          : "None"}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => openEditForm(course)}
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() => deleteCourse(course)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
