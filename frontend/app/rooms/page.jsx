"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { emptyRoomForm, featureFlags, roomFeatures, roomFormErrors, roomFormFromRoom, roomPayload, roomsPath } from "./room-form.mjs";
import { defaultSort, nextSort, pageNumbers, pageSizes, paginate, searchRooms, sortRooms } from "./room-table.mjs";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const noFilters = { has_projector: false, has_computers: false, is_lab: false };
const sortIndicators = { asc: "▲", desc: "▼" };

function ActionIcon({ name }) {
  const iconPaths = {
    add: <><path d="M12 5v14M5 12h14" /></>,
    edit: <><path d="m4 16-.8 4.8L8 20l11-11-4-4zM13.5 6.5l4 4" /></>,
    delete: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  };
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{iconPaths[name]}</svg>;
}

export default function RoomsPage() {
  const [rooms, setRooms] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [filters, setFilters] = useState(noFilters);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(defaultSort);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizes[0]);
  const [form, setForm] = useState(emptyRoomForm);
  const [formErrors, setFormErrors] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [notification, setNotification] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  function showNotification(text, type = "error") {
    setNotification({ text, type });
  }

  useEffect(() => {
    if (!notification) return undefined;
    const timeout = window.setTimeout(() => setNotification(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notification]);

  async function request(path, options) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
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

  async function refresh(activeFilters = filters) {
    try {
      setRooms(await request(roomsPath(activeFilters)));
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      throw error;
    }
  }

  useEffect(() => { refresh().catch((error) => showNotification(error.message)); }, []);

  async function toggleFilter(key) {
    const nextFilters = { ...filters, [key]: !filters[key] };
    setFilters(nextFilters);
    setPage(1);
    try {
      await refresh(nextFilters);
    } catch (error) { showNotification(error.message); }
  }

  async function submit(event) {
    event.preventDefault();
    const errors = roomFormErrors(form);
    setFormErrors(errors);
    if (Object.keys(errors).length) return;
    try {
      await request(editingId ? `/rooms/${editingId}` : "/rooms", {
        method: editingId ? "PUT" : "POST", body: JSON.stringify(roomPayload(form)),
      });
      closeForm();
      showNotification("Room saved successfully.", "success");
      await refresh();
    } catch (error) { showNotification(error.message); }
  }

  async function confirmDeleteSelected() {
    if (!deleteTarget?.id) return;
    const room = deleteTarget;
    const force = room.scheduled_sessions > 0 ? "?force=true" : "";
    try {
      await request(`/rooms/${room.id}${force}`, { method: "DELETE" });
    } catch (error) {
      setDeleteTarget(null);
      showNotification(error.message);
      await refresh().catch(() => {});
      return;
    }
    setDeleteTarget(null);

    try {
      await refresh();
      showNotification("Room deleted successfully.", "success");
    } catch (error) {
      showNotification(`Room deleted, but the list could not refresh. ${error.message}`);
    }
  }

  function updateSearch(value) {
    setSearch(value);
    setPage(1);
  }

  function changeSort(key) {
    setSort(nextSort(sort, key));
    setPage(1);
  }

  function changePageSize(size) {
    setPageSize(size);
    setPage(1);
  }

  function openCreateForm() {
    setEditingId(null);
    setForm(emptyRoomForm);
    setFormErrors({});
    setFormOpen(true);
  }

  function openEditForm(room) {
    setEditingId(room.id);
    setForm(roomFormFromRoom(room));
    setFormErrors({});
    setFormOpen(true);
  }

  function closeForm() {
    setEditingId(null);
    setFormOpen(false);
    setForm(emptyRoomForm);
    setFormErrors({});
  }

  function updateField(field, value) {
    setForm({ ...form, [field]: value });
    if (formErrors[field]) setFormErrors({ ...formErrors, [field]: undefined });
  }

  const filtering = featureFlags.some(({ key }) => filters[key]) || Boolean(search.trim());
  const table = paginate(sortRooms(searchRooms(rooms, search), sort), page, pageSize);

  function sortableHeader(key, label, className = "") {
    const active = sort.key === key;
    return <th scope="col" className={className} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={`room-sort ${active ? "is-active" : ""}`} onClick={() => changeSort(key)}>
        <span>{label}</span><span className="room-sort-indicator" aria-hidden="true">{active ? sortIndicators[sort.direction] : "↕"}</span>
      </button>
    </th>;
  }

  return <div className="campus-app">
    <nav className="navbar campus-nav">
      <div className="container"><Link className="navbar-brand" href="/">UNICAL <span>UNIVERSITY OF CALABRIA</span></Link>
        <div className="nav-actions">
          <Link className="btn btn-outline-light btn-sm" href="/">Degree programmes</Link>
          <Link className="btn btn-outline-light btn-sm" href="/calendar">Open timetable</Link>
        </div>
      </div>
    </nav>
    <main className="container degrees-main py-4">
      <header className="degrees-heading mb-3">
        <p className="eyebrow mb-2">ACADEMIC PLANNING</p>
        <div className="page-title-row">
          <h1 className="display-5 fw-semibold mb-1">Rooms</h1>
        </div>
        <p className="text-secondary mb-0">Manage the spaces available for scheduling classes.</p>
      </header>
      {notification && <div className={`app-notification app-notification-${notification.type}`} role={notification.type === "error" ? "alert" : "status"} aria-live="polite">
        <span className="notification-icon" aria-hidden="true">{notification.type === "success" ? "✓" : "!"}</span>
        <p className="notification-text">{notification.text}</p>
        <button type="button" className="notification-close" aria-label="Dismiss notification" onClick={() => setNotification(null)}>×</button>
      </div>}
      <div className="row g-4 align-items-start">
        <section className="col-12">
          <div className="d-flex align-items-center justify-content-between mb-3">
            <h2 className="h4 mb-0">Available rooms</h2>
            <div className="catalogue-header-actions">
              <span className="catalogue-total">{table.total} {filtering ? "matching" : "total"}</span>
              <button type="button" className="btn btn-campus create-degree-button" onClick={openCreateForm}><ActionIcon name="add" /><span>Create room</span></button>
            </div>
          </div>
          <div className="room-table-panel">
            <div className="room-table-toolbar">
              <label className="catalogue-search room-search">
                <ActionIcon name="search" />
                <input type="search" placeholder="Search by room code" aria-label="Search rooms by code" value={search} onChange={(e) => updateSearch(e.target.value)} />
              </label>
              <div className="room-filters" role="group" aria-label="Filter rooms by feature">
                <span className="room-filters-label">Filter by feature</span>
                {featureFlags.map(({ key, label }) => (
                  <button type="button" key={key} className={`filter-chip ${filters[key] ? "is-active" : ""}`} aria-pressed={filters[key]} onClick={() => toggleFilter(key)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0 room-table">
                <caption className="visually-hidden">Available rooms</caption>
                <colgroup>
                  <col />
                  <col className="room-col-capacity" />
                  <col className="room-col-features" />
                  <col className="room-col-scheduled" />
                  <col className="room-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    {sortableHeader("code", "Room name / code")}
                    {sortableHeader("capacity", "Capacity", "text-end")}
                    <th scope="col">Features</th>
                    {sortableHeader("scheduled_sessions", "Scheduled classes", "text-end")}
                    <th scope="col" className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((room) => (
                    <tr key={room.id}>
                      <th scope="row" className="room-code">{room.code}</th>
                      <td className="text-end room-number">{room.capacity}</td>
                      <td>
                        <div className="room-features">
                          {roomFeatures(room).map((feature) => <span className="semester-pill" key={feature}>{feature}</span>)}
                          {!roomFeatures(room).length && <span className="small text-secondary">None</span>}
                        </div>
                      </td>
                      <td className="text-end room-number">{room.scheduled_sessions}</td>
                      <td>
                        <div className="room-actions">
                          <button type="button" className="btn btn-edit" aria-label={`Edit ${room.code}`} onClick={() => openEditForm(room)}><ActionIcon name="edit" /><span>Edit</span></button>
                          <button type="button" className="btn btn-delete" aria-label={`Delete ${room.code}`} onClick={() => setDeleteTarget(room)}><ActionIcon name="delete" /><span>Delete</span></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!table.total && <tr>
                    <td colSpan="5" className="room-table-message">
                      {loadState === "loading" && <p className="text-secondary mb-0">Loading rooms…</p>}
                      {loadState === "error" && <><p className="fw-semibold mb-1">Rooms could not be loaded</p><p className="text-secondary small mb-0">Check that the API is running, then refresh the page.</p></>}
                      {loadState === "ready" && (filtering
                        ? <><p className="fw-semibold mb-1">No rooms match your search</p><p className="text-secondary small mb-0">Clear the search or a filter to see more rooms.</p></>
                        : <><p className="fw-semibold mb-1">No rooms yet</p><p className="text-secondary small mb-0">Create a room to start scheduling classes.</p></>)}
                    </td>
                  </tr>}
                </tbody>
              </table>
            </div>
            <div className="room-table-footer">
              <div className="room-page-size">
                <span className="room-filters-label" id="room-page-size-label">Rows per page</span>
                <div className="btn-group btn-group-sm" role="group" aria-labelledby="room-page-size-label">
                  {pageSizes.map((size) => (
                    <button type="button" key={size} className={`btn btn-page-size ${pageSize === size ? "is-active" : ""}`} aria-pressed={pageSize === size} onClick={() => changePageSize(size)}>{size}</button>
                  ))}
                </div>
              </div>
              <p className="room-page-range" role="status">{table.total ? `Showing ${table.first}–${table.last} of ${table.total} ${table.total === 1 ? "room" : "rooms"}` : "No rooms to show"}</p>
              <nav aria-label="Rooms pages">
                <ul className="pagination pagination-sm mb-0 room-pagination">
                  <li className={`page-item ${table.page === 1 ? "disabled" : ""}`}>
                    <button type="button" className="page-link" disabled={table.page === 1} onClick={() => setPage(table.page - 1)}>Previous</button>
                  </li>
                  {pageNumbers(table.page, table.pageCount).map((number, index) => (number === null
                    ? <li className="page-item disabled" key={`gap-${index}`}><span className="page-link" aria-hidden="true">…</span></li>
                    : <li className={`page-item ${number === table.page ? "active" : ""}`} key={number}>
                      <button type="button" className="page-link" aria-label={`Page ${number}`} aria-current={number === table.page ? "page" : undefined} onClick={() => setPage(number)}>{number}</button>
                    </li>))}
                  <li className={`page-item ${table.page === table.pageCount ? "disabled" : ""}`}>
                    <button type="button" className="page-link" disabled={table.page === table.pageCount} onClick={() => setPage(table.page + 1)}>Next</button>
                  </li>
                </ul>
              </nav>
            </div>
          </div>
        </section>
      </div>
      {formOpen && <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="room-form-title" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
        <section className="degree-form-modal">
          <div className="degree-form-modal-header">
            <div>
              <p className="eyebrow mb-1">{editingId ? "UPDATE ROOM" : "NEW SPACE"}</p>
              <h2 id="room-form-title" className="h4 mb-0">{editingId ? "Edit room" : "Create a room"}</h2>
            </div>
            <button type="button" className="degree-modal-close" aria-label="Close form" onClick={closeForm}>×</button>
          </div>
          <form onSubmit={submit} className="d-grid gap-3" noValidate>
            <div className="row g-3">
              <div className="col-7">
                <label className="form-label" htmlFor="room-code">Room name / code</label>
                <input id="room-code" className={`form-control ${formErrors.code ? "is-invalid" : ""}`} placeholder="e.g. MT1" maxLength="255" value={form.code}
                  aria-invalid={Boolean(formErrors.code)} aria-describedby="room-code-error"
                  onChange={(e) => updateField("code", e.target.value)} />
                {formErrors.code && <div id="room-code-error" className="invalid-feedback">{formErrors.code}</div>}
              </div>
              <div className="col-5">
                <label className="form-label" htmlFor="room-capacity">Max capacity</label>
                <input id="room-capacity" className={`form-control ${formErrors.capacity ? "is-invalid" : ""}`} type="number" min="1" step="1" placeholder="e.g. 60" value={form.capacity}
                  aria-invalid={Boolean(formErrors.capacity)} aria-describedby="room-capacity-error"
                  onChange={(e) => updateField("capacity", e.target.value)} />
                {formErrors.capacity && <div id="room-capacity-error" className="invalid-feedback">{formErrors.capacity}</div>}
              </div>
            </div>
            <fieldset>
              <legend className="form-label">Features</legend>
              {featureFlags.map(({ key, label }) => (
                <div className="form-check" key={key}>
                  <input id={`room-${key}`} className="form-check-input" type="checkbox" checked={form[key]}
                    onChange={(e) => updateField(key, e.target.checked)} />
                  <label className="form-check-label" htmlFor={`room-${key}`}>{label}</label>
                </div>
              ))}
            </fieldset>
            <div className="degree-form-modal-actions">
              <button type="button" className="btn btn-light" onClick={closeForm}>Cancel</button>
              <button className="btn btn-campus">{editingId ? "Save changes" : "Create room"}</button>
            </div>
          </form>
        </section>
      </div>}
      {deleteTarget && <div className="delete-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-room-title">
        <div className="delete-modal">
          <div className="delete-modal-header">
              <p className="eyebrow mb-1">CONFIRM ACTION</p>
              <h3 id="delete-room-title" className="h5 mb-0">Delete room?</h3>
          </div>
          <p className="delete-modal-text">This will permanently remove <strong>{deleteTarget.code}</strong> from the available rooms.</p>
          {deleteTarget.scheduled_sessions > 0 && <p className="delete-modal-warning" role="alert">
            <strong>Warning:</strong> this room is used by {deleteTarget.scheduled_sessions} scheduled {deleteTarget.scheduled_sessions === 1 ? "class" : "classes"} in the saved timetable. {deleteTarget.scheduled_sessions === 1 ? "It" : "They"} will be left without a room.
          </p>}
          <div className="delete-modal-actions">
              <button type="button" className="btn btn-light" onClick={() => setDeleteTarget(null)}>No, keep it</button>
              <button type="button" className="btn btn-delete btn-danger-confirm" onClick={confirmDeleteSelected}>{deleteTarget.scheduled_sessions > 0 ? "Delete anyway" : "Yes, delete"}</button>
          </div>
        </div>
      </div>}
    </main>
  </div>;
}
