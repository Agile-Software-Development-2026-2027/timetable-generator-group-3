"use client";

import { useCallback, useEffect, useState } from "react";
import { AppNav, Notification, useNotification } from "../components/app-shell.jsx";
import { matches, teachersByCourse, toggleId } from "../teachers/teacher-form.mjs";
import { pageNumbers, pageSizes, paginate } from "../rooms/room-table.mjs";

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

function ActionIcon({ name }) {
  const iconPaths = {
    edit: <path d="m4 16-.8 4.8L8 20l11-11-4-4zM13.5 6.5l4 4" />,
    delete: <path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" />,
  };
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {iconPaths[name]}
    </svg>
  );
}

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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizes[0]);
  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [notification, showNotification] = useNotification();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteWarning, setDeleteWarning] = useState("");
  const [deleteRequiresForce, setDeleteRequiresForce] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [filterDegree, setFilterDegree] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterSemester, setFilterSemester] = useState("");

  const [formYears, setFormYears] = useState([]);
  const [formSemesters, setFormSemesters] = useState([]);
  const [filterYears, setFilterYears] = useState([]);
  const [filterSemesters, setFilterSemesters] = useState([]);

  const [teachers, setTeachers] = useState([]);
  const [assignTarget, setAssignTarget] = useState(null);
  const [selectedTeachers, setSelectedTeachers] = useState([]);

  const refreshCourses = useCallback(async () => {
    const filters = [];

    if (filterDegree) {
      filters.push(`degree_id=${encodeURIComponent(filterDegree)}`);
    }

    if (filterYear) {
      filters.push(`year_id=${encodeURIComponent(filterYear)}`);
    }

    if (filterSemester) {
      filters.push(`semester_id=${encodeURIComponent(filterSemester)}`);
    }

    const query = filters.length > 0 ? `?${filters.join("&")}` : "";
    const [result, teacherList] = await Promise.all([
      request(`/courses${query}`),
      request("/teachers"),
    ]);
    setCourses(result);
    setTeachers(teacherList);
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
    setPage(1);
  }

  function changeFilterYear(yearId) {
    const semesters = getSemesters(yearId, filterYears);

    setFilterYear(yearId);
    setFilterSemester("");
    setFilterSemesters(semesters);
    setPage(1);
  }

  function changeFilterSemester(semesterId) {
    setFilterSemester(semesterId);
    setPage(1);
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

  function openDeleteConfirm(course) {
    setDeleteTarget(course);
    setDeleteWarning("");
    setDeleteRequiresForce(false);
  }

  function closeDeleteConfirm() {
    if (isDeleting) return;
    setDeleteTarget(null);
    setDeleteWarning("");
    setDeleteRequiresForce(false);
  }

  async function confirmDeleteSelected() {
    if (!deleteTarget?.id || isDeleting) return;
    const course = deleteTarget;
    const force = deleteRequiresForce;
    setIsDeleting(true);
    try {
      await request(`/courses/${course.id}${force ? "?force=true" : ""}`, {
        method: "DELETE",
      });
    } catch (error) {
      setIsDeleting(false);
      if (error.status === 409 && !force) {
        setDeleteRequiresForce(true);
        setDeleteWarning(error.message);
      } else {
        setDeleteTarget(null);
        setDeleteWarning("");
        setDeleteRequiresForce(false);
        showNotification(error.message);
      }
      return;
    }

    setIsDeleting(false);
    setDeleteTarget(null);
    setDeleteWarning("");
    setDeleteRequiresForce(false);
    showNotification(
      force
        ? "Course and its timetable sessions deleted."
        : "Course deleted successfully.",
      "success"
    );
    try {
      await refreshCourses();
    } catch (error) {
      showNotification(`Course deleted, but the list could not refresh. ${error.message}`);
    }
  }

  const assignedTeachers = teachersByCourse(teachers);
  const filteredCourses = courses.filter((course) =>
    matches(`${course.name} ${course.degree}`, search)
  );
  const coursePage = paginate(filteredCourses, page, pageSize);

  function openAssignForm(course) {
    setAssignTarget(course);
    setSelectedTeachers(
      (assignedTeachers.get(course.id) ?? []).map((teacher) => teacher.id)
    );
  }

  async function saveAssignment(event) {
    event.preventDefault();

    try {
      await request(`/courses/${assignTarget.id}/teachers`, {
        method: "PUT",
        body: JSON.stringify({ teacher_ids: selectedTeachers }),
      });

      setAssignTarget(null);
      showNotification("Teacher assignments saved.", "success");
      await refreshCourses();
    } catch (error) {
      showNotification(error.message);
    }
  }

  return (
    <div className="campus-app">
      <AppNav current="/courses" />
      <main className="container degrees-main py-4">
        <header className="degrees-heading mb-3">
          <p className="eyebrow mb-2">ACADEMIC PLANNING</p>
          <h1 className="display-5 fw-semibold mb-1">Courses</h1>
          <p className="text-secondary mb-0">Manage courses, assignments and scheduling requirements.</p>
        </header>

        <Notification notification={notification} onClose={() => showNotification(null)} />

        <div className="d-flex align-items-center justify-content-between mb-3">
          <h2 className="h4 mb-0">Course catalogue</h2>
          <div className="catalogue-header-actions">
            <span className="catalogue-total">{filteredCourses.length} {search.trim() ? "matching" : "total"}</span>
            <button type="button" className="btn btn-campus create-degree-button" onClick={openCreateForm}>Create course</button>
          </div>
        </div>

        <section className="room-table-panel course-filter-panel" aria-labelledby="course-filters-title">
          <div className="room-table-toolbar course-filter-toolbar">
            <h2 id="course-filters-title" className="h6 mb-0">Filter courses</h2>
            <div className="course-filter-controls">
              <label className="course-filter-field">
                <span>Degree</span>
                <select className="form-select" value={filterDegree} onChange={(event) => changeFilterDegree(event.target.value)}>
                  <option value="">All degrees</option>
                  {degrees.map((degree) => <option key={degree.id} value={degree.id}>{degree.name}</option>)}
                </select>
              </label>
              <label className="course-filter-field">
                <span>Year</span>
                <select className="form-select" value={filterYear} onChange={(event) => changeFilterYear(event.target.value)} disabled={!filterDegree}>
                  <option value="">All years</option>
                  {filterYears.map((year) => <option key={year.id} value={year.id}>Year {year.number}</option>)}
                </select>
              </label>
              <label className="course-filter-field">
                <span>Semester</span>
                <select className="form-select" value={filterSemester} onChange={(event) => changeFilterSemester(event.target.value)} disabled={!filterYear}>
                  <option value="">All semesters</option>
                  {filterSemesters.map((semester) => <option key={semester.id} value={semester.id}>Semester {semester.number}</option>)}
                </select>
              </label>
            </div>
          </div>
        </section>

        {formOpen && (
          <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="course-form-title" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
            <section className="course-form-modal">
              <div className="degree-form-modal-header">
                <div>
                  <p className="eyebrow mb-1">{editingId ? "UPDATE COURSE" : "COURSE DETAILS"}</p>
                  <h2 id="course-form-title" className="h4 mb-0">{editingId ? "Edit course" : "Create course"}</h2>
                </div>
                <button type="button" className="degree-modal-close" aria-label="Close form" onClick={closeForm}>×</button>
              </div>
              <form className="course-form-grid" onSubmit={submit}>
                <label className="course-form-field">
                  <span className="form-label">Course name</span>
                  <input className="form-control" type="text" value={form.name} maxLength={255} required onChange={(event) => setForm({ ...form, name: event.target.value })} />
                </label>
                <label className="course-form-field">
                  <span className="form-label">Degree</span>
                  <select className="form-select" value={form.degree_id} required onChange={(event) => changeFormDegree(event.target.value)}>
                    <option value="">Select a degree</option>
                    {degrees.map((degree) => <option key={degree.id} value={degree.id}>{degree.name}</option>)}
                  </select>
                </label>
                <label className="course-form-field">
                  <span className="form-label">Year</span>
                  <select className="form-select" value={form.year_id} required disabled={!form.degree_id} onChange={(event) => changeFormYear(event.target.value)}>
                    <option value="">Select a year</option>
                    {formYears.map((year) => <option key={year.id} value={year.id}>Year {year.number}</option>)}
                  </select>
                </label>
                <label className="course-form-field">
                  <span className="form-label">Semester</span>
                  <select className="form-select" value={form.semester_id} required disabled={!form.year_id} onChange={(event) => setForm({ ...form, semester_id: event.target.value })}>
                    <option value="">Select a semester</option>
                    {formSemesters.map((semester) => <option key={semester.id} value={semester.id}>Semester {semester.number}</option>)}
                  </select>
                </label>
                <label className="course-form-field">
                  <span className="form-label">Required weekly hours</span>
                  <input className="form-control" type="number" min="1" step="1" required value={form.weekly_hours} onChange={(event) => setForm({ ...form, weekly_hours: event.target.value })} />
                </label>
                <label className="course-form-field">
                  <span className="form-label">Estimated enrolled students</span>
                  <input className="form-control" type="number" min="1" step="1" required value={form.enrolled_students} onChange={(event) => setForm({ ...form, enrolled_students: event.target.value })} />
                </label>
                <fieldset className="course-form-requirements">
                  <legend className="form-label">Special requirements</legend>
                  <label className="form-check">
                    <input className="form-check-input" type="checkbox" checked={form.requires_lab} onChange={(event) => setForm({ ...form, requires_lab: event.target.checked })} />
                    <span className="form-check-label">Requires lab / PCs</span>
                  </label>
                  <label className="form-check">
                    <input className="form-check-input" type="checkbox" checked={form.requires_projector} onChange={(event) => setForm({ ...form, requires_projector: event.target.checked })} />
                    <span className="form-check-label">Requires projector</span>
                  </label>
                </fieldset>
                <div className="degree-form-modal-actions course-form-actions">
                  <button type="button" className="btn btn-light" onClick={closeForm}>Cancel</button>
                  <button type="submit" className="btn btn-campus">{editingId ? "Save changes" : "Create course"}</button>
                </div>
              </form>
            </section>
          </div>
        )}

        {assignTarget && (
          <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="assign-title">
            <section className="course-form-modal course-assignment-modal">
              <div className="degree-form-modal-header">
                <div>
                  <p className="eyebrow mb-1">COURSE STAFFING</p>
                  <h2 id="assign-title" className="h4 mb-0">Assign teachers</h2>
                  <p className="text-secondary small mb-0 mt-1">{assignTarget.name}</p>
                </div>
                <button type="button" className="degree-modal-close" aria-label="Close teacher assignment" onClick={() => setAssignTarget(null)}>×</button>
              </div>
              <form onSubmit={saveAssignment}>
                <fieldset className="assignment-list">
                  <legend className="form-label">Teachers</legend>
                  {teachers.length === 0 && <p className="small text-secondary mb-0">No teachers registered yet. Create one on the Teachers page.</p>}
                  {teachers.map((teacher) => (
                    <label className="form-check" key={teacher.id}>
                      <input className="form-check-input" type="checkbox" checked={selectedTeachers.includes(teacher.id)} onChange={() => setSelectedTeachers(toggleId(selectedTeachers, teacher.id))} />
                      <span className="form-check-label">{teacher.name} ({teacher.identifier})</span>
                    </label>
                  ))}
                </fieldset>
                <div className="degree-form-modal-actions course-form-actions">
                  <button type="button" className="btn btn-light" onClick={() => setAssignTarget(null)}>Cancel</button>
                  <button type="submit" className="btn btn-campus">Save assignments</button>
                </div>
              </form>
            </section>
          </div>
        )}

        {deleteTarget && (
          <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-course-title">
            <section className="delete-modal" aria-describedby="delete-course-description">
              <div className="delete-modal-header">
                <p className="eyebrow mb-1">CONFIRM ACTION</p>
                <h2 id="delete-course-title" className="h5 mb-0">
                  {deleteRequiresForce ? "Delete scheduled course?" : "Delete course?"}
                </h2>
              </div>
              <p id="delete-course-description" className="delete-modal-text">
                This will permanently remove <strong>{deleteTarget.name}</strong>.
              </p>
              {deleteWarning && (
                <p className="delete-modal-warning" role="alert">
                  <strong>Warning:</strong> {deleteWarning} Deleting the course will also remove its saved timetable sessions.
                </p>
              )}
              <div className="delete-modal-actions">
                <button type="button" className="btn btn-light" onClick={closeDeleteConfirm} disabled={isDeleting}>
                  No, keep it
                </button>
                <button type="button" className="btn btn-delete btn-danger-confirm" onClick={confirmDeleteSelected} disabled={isDeleting}>
                  {isDeleting ? "Deleting…" : deleteRequiresForce ? "Delete course and sessions" : "Yes, delete"}
                </button>
              </div>
            </section>
          </div>
        )}

        <section className="room-table-panel course-list-panel">
          <div className="room-table-toolbar course-table-toolbar">
            <h2 className="h5 mb-0">Courses</h2>
            <label className="catalogue-search room-search">
              <input type="search" placeholder="Search courses or degrees" aria-label="Search courses or degrees" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
            </label>
          </div>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0 room-table course-table">
              <caption className="visually-hidden">Course catalogue</caption>
              <thead>
                <tr>
                  <th scope="col">Course</th>
                  <th scope="col">Degree</th>
                  <th scope="col" className="text-end">Year</th>
                  <th scope="col" className="text-end">Semester</th>
                  <th scope="col" className="text-end">Weekly hours</th>
                  <th scope="col" className="text-end">Students</th>
                  <th scope="col">Requirements</th>
                  <th scope="col">Teachers</th>
                  <th scope="col" className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {coursePage.rows.map((course) => {
                  const requirements = [];
                  if (course.requires_lab) requirements.push("Lab / PCs");
                  if (course.requires_projector) requirements.push("Projector");
                  const courseTeachers = assignedTeachers.get(course.id) ?? [];

                  return (
                    <tr key={course.id}>
                      <th scope="row" className="room-code">{course.name}</th>
                      <td>{course.degree}</td>
                      <td className="text-end room-number">{course.year}</td>
                      <td className="text-end room-number">{course.semester}</td>
                      <td className="text-end room-number">{course.weekly_hours}</td>
                      <td className="text-end room-number">{course.enrolled_students}</td>
                      <td>{requirements.length ? requirements.join(", ") : "None"}</td>
                      <td>{courseTeachers.length ? courseTeachers.map((teacher) => teacher.name).join(", ") : "No teacher assigned"}</td>
                      <td>
                        <div className="room-actions">
                          <button type="button" className="btn btn-light" aria-label={`Assign teachers to ${course.name}`} onClick={() => openAssignForm(course)}>Assign</button>
                          <button type="button" className="btn btn-edit" aria-label={`Edit ${course.name}`} onClick={() => openEditForm(course)}><ActionIcon name="edit" /><span>Edit</span></button>
                          <button type="button" className="btn btn-delete" aria-label={`Delete ${course.name}`} onClick={() => openDeleteConfirm(course)}><ActionIcon name="delete" /><span>Delete</span></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!coursePage.total && (
                  <tr>
                    <td colSpan="9" className="room-table-message">
                      <p className="fw-semibold mb-0">{search.trim() ? "No courses match your search" : "No courses found"}</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!!coursePage.total && (
            <div className="room-table-footer">
              <div className="room-page-size">
                <label className="room-filters-label" htmlFor="course-page-size">Rows per page</label>
                <select id="course-page-size" className="form-select form-select-sm table-page-size-select" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
                  {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </div>
              <p className="room-page-range" role="status">Showing {coursePage.first}–{coursePage.last} of {coursePage.total} courses</p>
              <nav aria-label="Course pages">
                <ul className="pagination pagination-sm mb-0 room-pagination">
                  <li className={`page-item ${coursePage.page === 1 ? "disabled" : ""}`}>
                    <button type="button" className="page-link" disabled={coursePage.page === 1} onClick={() => setPage(coursePage.page - 1)}>Previous</button>
                  </li>
                  {pageNumbers(coursePage.page, coursePage.pageCount).map((number, index) => (number === null
                    ? <li className="page-item disabled" key={`gap-${index}`}><span className="page-link" aria-hidden="true">…</span></li>
                    : <li className={`page-item ${number === coursePage.page ? "active" : ""}`} key={number}>
                      <button type="button" className="page-link" aria-label={`Page ${number}`} aria-current={number === coursePage.page ? "page" : undefined} onClick={() => setPage(number)}>{number}</button>
                    </li>))}
                  <li className={`page-item ${coursePage.page === coursePage.pageCount ? "disabled" : ""}`}>
                    <button type="button" className="page-link" disabled={coursePage.page === coursePage.pageCount} onClick={() => setPage(coursePage.page + 1)}>Next</button>
                  </li>
                </ul>
              </nav>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
