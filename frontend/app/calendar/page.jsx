"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import breezyThemePlugin from "@fullcalendar/react/themes/breezy";
import { fetchAllSessions, getCalendarTimeRange } from "./sessions.mjs";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const GENERATION_RESULT_STORAGE_KEY = "timetable-generator:last-generation-result";
const SESSION_COLORS_STORAGE_KEY = "timetable-generator:session-colors";
const DEFAULT_SESSION_COLOR = "#176b68";
const DEFAULT_CALENDAR_EVENT_COLOR = "var(--fc-breezy-event)";
const DEFAULT_CALENDAR_EVENT_CONTRAST = "var(--fc-breezy-event-contrast)";
const CALENDAR_VIEW_TITLES = {
  dayGridMonth: "Monthly schedule",
  timeGridWeek: "Weekly schedule",
  timeGridDay: "Daily schedule",
};

function isStoredGenerationResult(value) {
  return value
    && ["ok", "partial", "infeasible"].includes(value.status)
    && Number.isInteger(value.sessions_created)
    && Array.isArray(value.unscheduled)
    && Number.isInteger(value.degree_id)
    && typeof value.degree_name === "string"
    && Number.isInteger(value.total_required_sessions)
    && typeof value.generated_at === "string"
    && Number.isFinite(Date.parse(value.generated_at));
}

function readableTextColor(hexColor) {
  const channels = hexColor.match(/[a-f\d]{2}/gi)?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) return "#ffffff";
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) > 0.179 ? "#172a35" : "#ffffff";
}

export default function TimetablePage() {
  const [degrees, setDegrees] = useState([]);
  const [selectedDegreeId, setSelectedDegreeId] = useState("");
  const [selectedSemesterId, setSelectedSemesterId] = useState("");
  const [semesters, setSemesters] = useState([]);
  const [calendarView, setCalendarView] = useState("timeGridWeek");
  const [courses, setCourses] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sessionColors, setSessionColors] = useState({});
  const [sessionColorError, setSessionColorError] = useState("");
  const [degreeError, setDegreeError] = useState("");
  const [courseError, setCourseError] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [generationResult, setGenerationResult] = useState(null);
  const [lastGenerationResult, setLastGenerationResult] = useState(null);
  const [generationConfirmationOpen, setGenerationConfirmationOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const generateButtonRef = useRef(null);
  const sessionEventElementsRef = useRef(new Map());

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(GENERATION_RESULT_STORAGE_KEY);
      if (!saved) return;
      const result = JSON.parse(saved);
      if (!isStoredGenerationResult(result)) {
        setGenerationError("The saved generation summary is invalid and could not be restored.");
        return;
      }
      setLastGenerationResult(result);
      setGenerationResult(result);
  } catch {
      setGenerationError("The saved generation summary could not be read from this browser.");
    }
  }, []);

  useEffect(() => {
    sessionEventElementsRef.current.forEach((entry, sessionId) => {
      const color = sessionColors[sessionId];
      if (color) {
        entry.element.style.setProperty("--fc-event-color", color);
        entry.element.style.setProperty("--fc-event-contrast-color", readableTextColor(color));
      } else {
        entry.element.style.setProperty("--fc-event-color", entry.defaultColor);
        entry.element.style.setProperty("--fc-event-contrast-color", entry.defaultContrastColor);
      }
    });
  }, [sessionColors]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SESSION_COLORS_STORAGE_KEY);
      if (!saved) return;
      const colors = JSON.parse(saved);
      if (!colors || typeof colors !== "object" || Array.isArray(colors)
        || Object.values(colors).some((color) => typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color))) {
        throw new Error("Saved class colors are invalid.");
      }
      setSessionColors(colors);
    } catch {
      setSessionColorError("Saved class colors could not be loaded in this browser.");
    }
  }, []);

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

  useEffect(() => {
    let active = true;
    async function loadData() {
      const [degreeResult, courseResult, roomResult, sessionResult] = await Promise.allSettled([
        request("/degrees"), request("/courses"), request("/rooms"), fetchAllSessions(request),
      ]);
      if (!active) return;
      if (degreeResult.status === "fulfilled") {
        setDegrees(degreeResult.value);
        setSelectedDegreeId((current) =>
  degreeResult.value.some((degree) => String(degree.id) === String(current))
    ? current
    : ""
);
        setDegreeError("");
      } else {
        setDegreeError(degreeResult.reason.message);
      }
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

    useEffect(() => {
    if (!selectedDegreeId) {
      setSemesters([]);
      setSelectedSemesterId("");
      return;
    }

    let active = true;

    async function loadSemesters() {
      try {
        const degree = await request(`/degrees/${selectedDegreeId}`);
        const availableSemesters = (degree.years || []).flatMap((year) =>
          (year.semesters || []).map((semester) => ({
            ...semester,
            year_number: year.number,
          }))
        );

        if (active) {
          setSemesters(availableSemesters);
          setSelectedSemesterId("");
        }
      } catch (error) {
        if (active) {
          setSemesters([]);
          setSelectedSemesterId("");
          setGenerationError(`Could not load semesters: ${error.message}`);
        }
      }
    }

    loadSemesters();

    return () => {
      active = false;
    };
  }, [selectedDegreeId]);

  function requestGeneration(event) {
    event.preventDefault();
    setGenerationConfirmationOpen(true);
  }

  function closeGenerationConfirmation() {
    setGenerationConfirmationOpen(false);
    generateButtonRef.current?.focus();
  }

  useEffect(() => {
    if (!generationConfirmationOpen && !generationResult && !selectedSession) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (generationConfirmationOpen) closeGenerationConfirmation();
        else if (generationResult) setGenerationResult(null);
        else setSelectedSession(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [generationConfirmationOpen, generationResult, selectedSession]);

  function showSessionDetails(eventInfo) {
    const sessionId = String(eventInfo.event.id);
    if (!sessionEventElementsRef.current.has(sessionId)) {
      sessionEventElementsRef.current.set(sessionId, {
        element: eventInfo.el,
        defaultColor: DEFAULT_CALENDAR_EVENT_COLOR,
        defaultContrastColor: DEFAULT_CALENDAR_EVENT_CONTRAST,
      });
    }
    setSelectedSession(eventInfo.event.extendedProps.session);
  }

  function mountCalendarEvent(eventInfo) {
    const sessionId = String(eventInfo.event.id);
    const entry = {
      element: eventInfo.el,
      defaultColor: DEFAULT_CALENDAR_EVENT_COLOR,
      defaultContrastColor: DEFAULT_CALENDAR_EVENT_CONTRAST,
    };
    sessionEventElementsRef.current.set(sessionId, entry);
    const color = sessionColors[sessionId];
    if (color) {
      eventInfo.el.style.setProperty("--fc-event-color", color);
      eventInfo.el.style.setProperty("--fc-event-contrast-color", readableTextColor(color));
    }
  }

  function unmountCalendarEvent(eventInfo) {
    const sessionId = String(eventInfo.event.id);
    const entry = sessionEventElementsRef.current.get(sessionId);
    if (entry?.element === eventInfo.el) {
      sessionEventElementsRef.current.delete(sessionId);
    }
  }

  function saveSessionColors(colors) {
    try {
      window.localStorage.setItem(SESSION_COLORS_STORAGE_KEY, JSON.stringify(colors));
      setSessionColors(colors);
      setSessionColorError("");
    } catch {
      setSessionColorError("The class color could not be saved in this browser.");
    }
  }

  function changeSessionColor(sessionId, color) {
    saveSessionColors({ ...sessionColors, [sessionId]: color });
    const entry = sessionEventElementsRef.current.get(String(sessionId));
    if (entry) {
      entry.element.style.setProperty("--fc-event-color", color);
      entry.element.style.setProperty("--fc-event-contrast-color", readableTextColor(color));
    }
  }

  function resetSessionColor(sessionId) {
    const colors = { ...sessionColors };
    delete colors[sessionId];
    saveSessionColors(colors);
    const entry = sessionEventElementsRef.current.get(String(sessionId));
    if (entry) {
      entry.element.style.setProperty("--fc-event-color", entry.defaultColor);
      entry.element.style.setProperty("--fc-event-contrast-color", entry.defaultContrastColor);
    }
  }

  async function generateTimetable(degreeId) {
    setGenerationError("");
    setGenerationResult(null);
    setGenerating(true);
    try {
      const result = await request("/timetable/generate", {
        method: "POST",
        body: JSON.stringify({
        degree_id: Number(degreeId),
        semester_id: selectedSemesterId ? Number(selectedSemesterId) : null,
        }),
      });
      if (!["ok", "partial", "infeasible"].includes(result?.status)
        || !Number.isInteger(result.sessions_created)
        || !Array.isArray(result.unscheduled)) {
        throw new Error("The server returned an invalid timetable generation result.");
      }
      const selectedDegreeName = degrees.find((item) => String(item.id) === String(degreeId))?.name
        || "the selected degree programme";
      const completedResult = {
        ...result,
        degree_id: Number(degreeId),
        degree_name: selectedDegreeName,
        total_required_sessions: courses
          .filter((course) => String(course.degree_id) === String(degreeId))
          .reduce((total, course) => total + course.weekly_hours, 0),
        generated_at: new Date().toISOString(),
      };
     setGenerationResult(completedResult);
setGenerationConfirmationOpen(false);
}
      setLastGenerationResult(completedResult);
      try {
        window.localStorage.setItem(
          GENERATION_RESULT_STORAGE_KEY,
          JSON.stringify(completedResult)
        );
      } catch {
        setGenerationError("Generation completed, but its summary could not be saved in this browser.");
      }
      setSessions(await fetchAllSessions(request));
      setScheduleError("");
    } catch (error) {
      setGenerationResult(null);
      setLastGenerationResult(null);
      try {
  window.localStorage.removeItem(GENERATION_RESULT_STORAGE_KEY);
} catch {
  // Ignore local storage errors.
}
      setGenerationConfirmationOpen(true);
      setGenerationError(`Timetable generation failed: ${error.message}`);
    } finally {
      setGenerating(false);
    }
  }
    async function clearTimetable() {
    if (!selectedDegreeId) {
      setScheduleError("Please select a degree programme first.");
      return;
    }

    setScheduleError("");

    try {
      await request(
        `/timetable/sessions?degree_id=${encodeURIComponent(Number(selectedDegreeId))}`,
        { method: "DELETE" }
      );

      setSessions(await fetchAllSessions(request));
      setGenerationResult(null);
      setLastGenerationResult(null);

      try {
        window.localStorage.removeItem(GENERATION_RESULT_STORAGE_KEY);
      } catch {
        // Ignore local storage errors.
      }
    } catch (error) {
      setScheduleError(`Could not clear the timetable: ${error.message}`);
    }
  }
  async function confirmGeneration() {
    await generateTimetable(selectedDegreeId);
  }

  const degreeName = degrees.find((item) => String(item.id) === selectedDegreeId)?.name
    || "the selected degree programme";
  const selectedDegreeCourses = courses.filter(
    (course) => String(course.degree_id) === selectedDegreeId
  );
  const selectedDegreeCourseIds = new Set(selectedDegreeCourses.map((course) => course.id));
  const selectedDegreeSessionCount = sessions.filter(
    (item) => selectedDegreeCourseIds.has(item.course_id)
  ).length;
  const placedSessionCount = generationResult
    ? Math.min(generationResult.sessions_created, generationResult.total_required_sessions)
    : 0;
  const generationProgress = generationResult?.total_required_sessions > 0
    ? Math.round((placedSessionCount / generationResult.total_required_sessions) * 100)
    : 0;
  const calendarTimeRange = getCalendarTimeRange(sessions);
  const events = sessions.map((item) => {
    const course = courses.find((entry) => entry.id === item.course_id);
    const room = rooms.find((entry) => entry.id === item.room_id);
    return {
      id: String(item.id), title: `${course?.name || "Course"}${room ? ` · ${room.code}` : ""}`,
      daysOfWeek: [(item.weekday + 1) % 7], startTime: item.start_time, endTime: item.end_time,
      extendedProps: { course_id: item.course_id, room_id: item.room_id, session: item },
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
    </div>    </nav>
    <main className="container timetable-main">
      {courseError && <div className="alert alert-warning timetable-alert" role="status">Could not load courses: {courseError}</div>}
      {scheduleError && <div className="alert alert-warning timetable-alert" role="status">
        Could not load timetable data: {scheduleError}
      </div>}
      {degreeError && <div className="alert alert-warning timetable-alert" role="status">
        Could not load degree programmes: {degreeError}
      </div>}
      {sessionColorError && !selectedSession
        && <div className="alert alert-warning timetable-alert" role="status">{sessionColorError}</div>}
      {generationError && <div className="alert alert-danger" role="alert">{generationError}</div>}
      <form className="card campus-card timetable-generation mb-3" onSubmit={requestGeneration}>
        <div className="timetable-generation-intro">
          <span className="timetable-generation-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
              <path d="M7.5 3v4M16.5 3v4M3.5 10h17M8 14h3m-3 3h7" />
            </svg>
          </span>
          <div>
            <h2>Create a timetable</h2>
            <p>Choose a degree programme and we’ll find suitable times and rooms for its courses.</p>
          </div>
        </div>
        <div className="timetable-controls">
          <div className="timetable-controls-footer">
            <div className="timetable-actions">
              <button ref={generateButtonRef} type="submit" className="btn btn-campus"
                disabled={generating}>
                {generating ? "Generating…" : "Generate timetable"}
              </button>
              <button
              type="button"
              className="btn btn-outline-danger"
              onClick={clearTimetable}
              disabled={!selectedDegreeId || generating}
            >
              Clear timetable
            </button>
              {lastGenerationResult && !generationResult && <button type="button"
                className="btn btn-outline-secondary" onClick={() => setGenerationResult(lastGenerationResult)}>
                View last result
              </button>}
            </div>
          </div>
        </div>
      </form>
      {!scheduleError && !sessions.length && <div className="empty-calendar mb-3">
        <span className="empty-calendar-icon" aria-hidden="true">▦</span>
        <span><strong>Your timetable is clear</strong><small>Scheduled classes will appear here.</small></span>
      </div>}
      <section className="card campus-card timetable-card"
        aria-label={`${CALENDAR_VIEW_TITLES[calendarView] || "Timetable"} view`}>
        <div className="timetable-calendar-heading">
          <div>
            <h2>{CALENDAR_VIEW_TITLES[calendarView] || "Timetable"}</h2>
            <p>Select any class to see its room and teacher details.</p>
          </div>
          <div className="schedule-count" aria-live="polite" aria-label={`${sessions.length} scheduled classes`}>
            <strong>{sessions.length}</strong>
            <span>{sessions.length === 1 ? "scheduled class" : "scheduled classes"}</span>
          </div>
        </div>
        <FullCalendar plugins={[dayGridPlugin, timeGridPlugin, breezyThemePlugin]}
          firstDay={1} initialView="timeGridWeek"
          headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay" }}
          events={events} allDaySlot={false} slotMinTime={calendarTimeRange.min}
          slotMaxTime={calendarTimeRange.max} height="auto" nowIndicator
          eventClick={showSessionDetails}
          eventDidMount={mountCalendarEvent}
          eventWillUnmount={unmountCalendarEvent}
          datesSet={(info) => setCalendarView(info.view.type)} />
      </section>
      {generationResult && ( <div className="generation-result-backdrop" role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setGenerationResult(null);
        }}>
        <section className="generation-result-dialog" role="dialog" aria-modal="true" aria-live="polite"
          aria-labelledby="generation-results-heading">
          <button type="button" className="session-details-close generation-result-close"
            aria-label="Close generation summary" onClick={() => setGenerationResult(null)}>×</button>
          <div className={`generation-results-summary generation-summary-${generationResult.status}`}>
            <span className="generation-summary-icon" aria-hidden="true">
              {generationResult.status === "ok" ? "✓" : generationResult.status === "partial" ? "!" : "×"}
            </span>
            <div className="generation-summary-copy">
              <h2 id="generation-results-heading">
                {generationResult.status === "ok" ? "Timetable generated"
                  : generationResult.status === "partial" ? "Timetable partially generated"
                    : "Timetable could not be generated"}
              </h2>
              <p>
                {generationResult.total_required_sessions > 0
                  ? `${generationResult.sessions_created} of ${generationResult.total_required_sessions} required sessions placed`
                  : `${generationResult.sessions_created} ${generationResult.sessions_created === 1 ? "session was" : "sessions were"} placed successfully.`}
              </p>
            </div>
            {generationResult.unscheduled.length > 0 && <span className="generation-unscheduled-count">
              {generationResult.unscheduled.length} {generationResult.unscheduled.length === 1 ? "course" : "courses"} need attention
            </span>}
          </div>
          {generationResult.total_required_sessions > 0 && <div className="generation-progress">
            <div className="generation-progress-label">
              <span>Generation progress</span>
              <strong>{generationProgress}%</strong>
            </div>
            <div className="generation-progress-track" role="progressbar"
              aria-label="Timetable generation progress"
              aria-valuemin="0" aria-valuemax={generationResult.total_required_sessions}
              aria-valuenow={placedSessionCount}
              aria-valuetext={`${generationResult.sessions_created} of ${generationResult.total_required_sessions} sessions placed`}>
              <span className={`generation-progress-fill generation-progress-${generationResult.status}`}
                style={{ width: `${generationProgress}%` }} />
            </div>
          </div>}
          {generationResult.unscheduled.length > 0
            ? <div className="generation-unscheduled">
              <div className="generation-unscheduled-heading">
                <div>
                  <h3>Unscheduled courses</h3>
                  <p>These courses could not be placed in the timetable.</p>
                </div>
              </div>
              <ul className="generation-unscheduled-list">
                {generationResult.unscheduled.map((item, index) => {
                  const categoryEnd = item.reason.indexOf(": ");
                  const category = categoryEnd >= 0 ? item.reason.slice(0, categoryEnd) : "Reason";
                  const details = categoryEnd >= 0 ? item.reason.slice(categoryEnd + 2) : item.reason;
                  return <li className="generation-unscheduled-item" key={item.course_id}>
                    <span className="generation-course-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <div className="generation-course-details">
                      <h4>{item.name}</h4>
                      <p className="generation-course-reason"><span>{category}:</span> {details}</p>
                    </div>
                  </li>;
                })}
              </ul>
            </div>
            : <p className="generation-no-unscheduled mb-0">{generationResult.status === "ok"
              ? "All required courses were scheduled."
              : "No unscheduled course details were provided."}</p>}
          <div className="generation-result-actions">
            <button type="button" className="btn btn-campus"
              onClick={() => setGenerationResult(null)}>View timetable</button>
          </div>
        </section>
      </div>)}
      {selectedSession && <div className="session-details-backdrop" role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedSession(null);
        }}>
        <section className="session-details-dialog" role="dialog" aria-modal="true"
          aria-labelledby="session-details-title">
          <div className="session-details-heading">
            <div>
              <p className="eyebrow mb-1">TIMETABLE SESSION</p>
              <h2 id="session-details-title">{selectedSession.course_name}</h2>
            </div>
            <button type="button" className="session-details-close" aria-label="Close session details"
              onClick={() => setSelectedSession(null)}>×</button>
          </div>
          <dl className="session-details-list">
            <div><dt>Day</dt><dd>{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][selectedSession.weekday]}</dd></div>
            <div><dt>Time</dt><dd>{selectedSession.start_time.slice(0, 5)}–{selectedSession.end_time.slice(0, 5)}</dd></div>
            <div><dt>Room</dt><dd>{selectedSession.room_code || "Not assigned"}</dd></div>
            <div><dt>Degree programme</dt><dd>{selectedSession.degree_name}</dd></div>
            <div><dt>Teacher{selectedSession.teacher_names?.length === 1 ? "" : "s"}</dt>
              <dd>{selectedSession.teacher_names?.length ? selectedSession.teacher_names.join(", ") : "Not assigned"}</dd></div>
          </dl>
          <div className="session-color-setting">
            <label htmlFor="session-color">Color for this class</label>
            <div className="session-color-controls">
              <input id="session-color" type="color"
                aria-label={`Color for ${selectedSession.course_name}`}
                value={sessionColors[selectedSession.id] || DEFAULT_SESSION_COLOR}
                onChange={(event) => changeSessionColor(selectedSession.id, event.target.value)} />
              {sessionColors[selectedSession.id] && <button type="button" className="btn btn-sm btn-outline-secondary"
                onClick={() => resetSessionColor(selectedSession.id)}>Use default color</button>}
            </div>
            <p>Changes only this scheduled class and are saved in this browser.</p>
            {sessionColorError && <p className="session-color-error" role="alert">{sessionColorError}</p>}
          </div>
          <div className="session-details-actions">
            <button type="button" className="btn btn-campus"
              onClick={() => setSelectedSession(null)}>Close details</button>
          </div>
        </section>
      </div>}
      {generationConfirmationOpen && <div className="generation-confirm-backdrop" role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeGenerationConfirmation();
        }}>
        <section className="generation-confirm-dialog" role="dialog" aria-modal="true"
          aria-labelledby="generation-confirmation-title">
          <div className="generation-confirm-topline" />
          <div className="generation-confirm-heading">
            <span className="generation-confirm-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5z" />
                <path d="M8 2v4m8-4v4M4 9h16M8 13h3m-3 4h6" />
              </svg>
            </span>
            <div className="generation-confirm-heading-copy">
              <p className="eyebrow mb-1">FINAL REVIEW</p>
              <h2 id="generation-confirmation-title" className="h5 mb-0">Generate a new timetable?</h2>
              <p className="generation-confirm-intro">Take a moment to review what will change.</p>
            </div>
          </div>
          <div className="generation-confirm-degree mb-3">
  <label className="form-label" htmlFor="modal-degree">
    Degree programme *
  </label>
  <select
    id="modal-degree"
    className="form-select"
    value={selectedDegreeId}
    onChange={(event) => {
      setSelectedDegreeId(event.target.value);
      setGenerationError("");
    }}
    required
  >
    <option value="">Select a degree programme</option>
    {degrees.map((degree) => (
      <option key={degree.id} value={degree.id}>
        {degree.name}
      </option>
    ))}
  </select>

  <label className="form-label mt-3" htmlFor="modal-semester">
    Semester (optional)
  </label>
  <select
    id="modal-semester"
    className="form-select"
    value={selectedSemesterId}
    onChange={(event) => setSelectedSemesterId(event.target.value)}
    disabled={!semesters.length}
  >
    <option value="">All semesters</option>
    {semesters.map((semester) => (
      <option key={semester.id} value={semester.id}>
        Year {semester.year_number} – Semester {semester.number}
      </option>
    ))}
  </select>
</div>
          <div className="generation-confirm-summary">
            <div className="generation-confirm-degree">
              <span className="generation-confirm-summary-label">Selected programme</span>
              <strong>{degreeName}</strong>
            </div>
            <div className="generation-confirm-stats" aria-label="Schedule impact">
              <div>
                <strong>{selectedDegreeCourses.length}</strong>
                <span>{selectedDegreeCourses.length === 1 ? "course" : "courses"} included</span>
              </div>
              <div>
                <strong>{selectedDegreeSessionCount}</strong>
                <span>{selectedDegreeSessionCount === 1 ? "session" : "sessions"} to replace</span>
              </div>
            </div>
          </div>
          {generationResult && ["partial", "infeasible"].includes(generationResult.status) && (
  <div className="alert alert-warning" role="alert">
    <h3>
      {generationResult.status === "partial"
        ? "Timetable partially generated"
        : "Timetable could not be generated"}
    </h3>
    <p>Unscheduled courses:</p>
    {generationResult.unscheduled.length > 0 ? (
      <ul>
        {generationResult.unscheduled.map((course) => (
          <li key={course.course_id}>
            <strong>{course.name}</strong>: {course.reason}
          </li>
        ))}
      </ul>
    ) : (
      <p>No unscheduled course details were provided.</p>
    )}
  </div>
)}
          <div className="generation-confirm-warning" role="note">
            <span className="generation-confirm-warning-icon" aria-hidden="true">!</span>
            <div>
              <strong>Your current schedule will be replaced</strong>
              <span>Existing sessions for this degree will be replaced with the newly generated schedule.</span>
            </div>
          </div>
          <p className="generation-confirm-assurance">
            The new timetable will be checked against room, teacher, and student-group constraints before it is saved.
          </p>
          <div className="generation-confirm-actions">
            <button type="button" className="btn btn-light" autoFocus
              onClick={closeGenerationConfirmation}>Keep current timetable</button>
            <button type="button" className="btn btn-campus generation-confirm-submit"
              disabled={generating || !selectedDegreeId}
onClick={confirmGeneration}>Generate timetable</button>
          </div>
        </section>
      </div>}
      {generating && <div className="generation-loading-backdrop" role="presentation">
        <section className="generation-loading-dialog" role="dialog" aria-modal="true"
          aria-labelledby="generation-loading-title" aria-describedby="generation-loading-description">
          <div className="generation-loading-animation" aria-hidden="true">
            <span className="generation-loading-orbit generation-loading-orbit-one" />
            <span className="generation-loading-orbit generation-loading-orbit-two" />
            <span className="generation-loading-orbit generation-loading-orbit-three" />
            <span className="generation-loading-core">T</span>
          </div>
          <p className="eyebrow mb-2">TIMETABLE GENERATION</p>
          <h2 id="generation-loading-title">Building your timetable</h2>
          <p id="generation-loading-description">
            Finding suitable times and rooms for <strong>{degreeName}</strong>.
          </p>
          <div className="generation-loading-progress" role="progressbar"
            aria-label="Timetable generation in progress" aria-valuetext="Generation in progress">
            <span />
          </div>
          <p className="generation-loading-note">Checking course, room, and teacher constraints…</p>
        </section>
      </div>}
    </main>
  </div>;
}
