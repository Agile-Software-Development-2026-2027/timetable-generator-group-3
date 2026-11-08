"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import breezyThemePlugin from "@fullcalendar/react/themes/breezy";
import { fetchAllSessions } from "./sessions.mjs";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function TimetablePage() {
  const [courses, setCourses] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [degrees, setDegrees] = useState([]);
  const [selectedDegreeId, setSelectedDegreeId] = useState("");
  const [courseError, setCourseError] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [degreeError, setDegreeError] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  async function request(path, options) {
    const response = await fetch(`${API}${path}`, {
      ...options, headers: { "Content-Type": "application/json", ...options?.headers },
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok) {
      const detail = Array.isArray(body?.detail)
        ? body.detail.map((issue) => issue.msg).join(" ")
        : body?.detail;
      throw new Error(detail || `Request failed (${response.status}).`);
    }
    return body;
  }

  async function refreshSessions() {
    try {
      setSessions(await fetchAllSessions(request));
      setScheduleError("");
    } catch (error) {
      setScheduleError(error.message);
    }
  }

  useEffect(() => {
    let active = true;
    async function loadData() {
      const [courseResult, roomResult, sessionResult, degreeResult] = await Promise.allSettled([
        request("/courses"), request("/rooms"), fetchAllSessions(request), request("/degrees"),
      ]);
      if (!active) return;
      if (courseResult.status === "fulfilled") {
        setCourses(courseResult.value);
        setCourseError("");
      } else {
        setCourseError(courseResult.reason.message);
      }
      if (roomResult.status === "fulfilled") setRooms(roomResult.value);
      if (sessionResult.status === "fulfilled") {
        setSessions(sessionResult.value);
        setScheduleError("");
      } else {
        setScheduleError(sessionResult.reason.message);
      }
      if (degreeResult.status === "fulfilled") {
        setDegrees(degreeResult.value);
        setDegreeError("");
        setSelectedDegreeId((current) => current || String(degreeResult.value[0]?.id ?? ""));
      } else {
        setDegreeError(degreeResult.reason.message);
      }
    }
    loadData();
    const timer = window.setInterval(loadData, 30000);
    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") loadData();
    };
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, []);

  const selectedDegree = degrees.find((degree) => String(degree.id) === selectedDegreeId);
  const degreeCourses = courses.filter((course) => String(course.degree_id) === selectedDegreeId);
  const degreeSessions = sessions.filter((session) =>
    degreeCourses.some((course) => course.id === session.course_id));

  async function generateTimetable() {
    if (!selectedDegreeId || generating) return;
    setConfirmationOpen(false);
    setGenerating(true);
    setGenerationError("");
    setGenerationMessage("");
    try {
      const result = await request("/timetable/generate", {
        method: "POST", body: JSON.stringify({ degree_id: Number(selectedDegreeId) }),
      });
      if (!["ok", "partial", "infeasible"].includes(result?.status)) {
        throw new Error("The server returned an unrecognized generation status.");
      }
      const placed = Number(result.sessions_created ?? 0);
      if (result.status === "ok") {
        setGenerationMessage(`Timetable generated: ${placed} sessions placed.`);
      } else if (result.status === "partial") {
        setGenerationMessage(`Partial timetable: ${placed} sessions placed. Some courses could not be scheduled.`);
      } else {
        setGenerationMessage("Timetable infeasible: required sessions could not be scheduled.");
      }
      await refreshSessions();
    } catch (error) {
      setGenerationError(error.message);
    } finally {
      setGenerating(false);
    }
  }

  const events = sessions.map((item) => {
    const course = courses.find((entry) => entry.id === item.course_id);
    const room = rooms.find((entry) => entry.id === item.room_id);
    return {
      id: String(item.id), title: `${course?.name || "Course"}${room ? ` · ${room.code}` : ""}`,
      daysOfWeek: [(item.weekday + 1) % 7], startTime: item.start_time, endTime: item.end_time,
      extendedProps: { course_id: item.course_id, room_id: item.room_id },
    };
  });

  return <div className="campus-app">
    <nav className="navbar campus-nav"><div className="container">
      <Link className="navbar-brand" href="/">UNICAL <span>UNIVERSITY OF CALABRIA</span></Link>
      <div className="nav-actions">
        <Link className="btn btn-outline-light btn-sm" href="/">Degree programmes</Link>
        <Link className="btn btn-outline-light btn-sm" href="/data-loader">Data Loader</Link>
        <Link className="btn btn-outline-light btn-sm" href="/rooms">Rooms</Link>
        <Link className="btn btn-outline-light btn-sm" href="/teachers">Teachers</Link>
        <Link className="btn btn-outline-light btn-sm" href="/courses">Courses</Link>
      </div>
    </div></nav>
    <main className="container py-5">
      <header className="timetable-heading mb-4">
        <div><p className="eyebrow mb-2">UNIVERSITY OF CALABRIA / ACADEMIC PLANNING</p>
          <h1 className="display-5 fw-semibold mb-2">Timetable</h1>
          <p className="text-secondary mb-0">Your weekly classes, all in one place.</p></div>
        <div className="schedule-count"><strong>{sessions.length}</strong><span>scheduled classes</span></div>
      </header>
      <section className="card campus-card p-3 mb-3" aria-label="Timetable generation">
        <div className="d-flex flex-wrap align-items-end gap-3">
          <div className="flex-grow-1">
            <label className="form-label" htmlFor="degree-programme">Degree programme</label>
            <select id="degree-programme" className="form-select" value={selectedDegreeId}
              onChange={(event) => setSelectedDegreeId(event.target.value)} disabled={generating}>
              {!degrees.length && <option value="">No degree programmes available</option>}
              {degrees.map((degree) => <option key={degree.id} value={degree.id}>{degree.name}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-primary" disabled={!selectedDegreeId || generating}
            onClick={() => { setGenerationError(""); setGenerationMessage(""); setConfirmationOpen(true); }}>
            {generating ? "Generating…" : "Generate timetable"}
          </button>
        </div>
      </section>
      {degreeError && <div className="alert alert-warning" role="alert">Could not load degrees: {degreeError}</div>}
      {generationError && <div className="alert alert-danger" role="alert">{generationError}</div>}
      {generationMessage && <div className="alert alert-info" role="status">{generationMessage}</div>}
      {generating && <div role="status" aria-live="polite">Generating timetable, please wait…</div>}
      {confirmationOpen && <div role="dialog" aria-modal="true" aria-labelledby="generation-confirm-title"
        className="card campus-card p-4 mb-3 border-warning">
        <h2 id="generation-confirm-title" className="h5">Generate a new timetable?</h2>
        <p>Generate a timetable for <strong>{selectedDegree?.name}</strong>?</p>
        <p>This will replace existing sessions for this degree ({degreeSessions.length} scheduled classes).
          The scheduler checks room, teacher, and student-group constraints.</p>
        <div className="d-flex gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => setConfirmationOpen(false)}>
            Keep current timetable
          </button>
          <button type="button" className="btn btn-primary" onClick={generateTimetable}>
            Confirm generation
          </button>
        </div>
      </div>}
      {courseError && <div className="alert alert-warning timetable-alert" role="status">Could not load courses: {courseError}</div>}
      {scheduleError && <div className="alert alert-warning timetable-alert" role="status">
        Could not load timetable data: {scheduleError}
      </div>}
      {!scheduleError && !sessions.length && <div className="empty-calendar mb-3">
        <span className="empty-calendar-icon" aria-hidden="true">▦</span>
        <span><strong>Your timetable is clear</strong><small>Scheduled classes will appear here.</small></span>
      </div>}
      <section className="card campus-card timetable-card">
        <FullCalendar plugins={[dayGridPlugin, timeGridPlugin, breezyThemePlugin]}
          firstDay={1} initialView="timeGridWeek"
          headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay" }}
          events={events} allDaySlot={false} slotMinTime="07:00:00" slotMaxTime="22:00:00"
          height={720} nowIndicator />
      </section>
    </main>
  </div>;
}
