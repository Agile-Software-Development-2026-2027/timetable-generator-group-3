"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import breezyThemePlugin from "@fullcalendar/react/themes/breezy";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function TimetablePage() {
  const [courses, setCourses] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [courseError, setCourseError] = useState("");
  const [scheduleError, setScheduleError] = useState("");

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
      const [courseResult, roomResult, sessionResult] = await Promise.allSettled([
        request("/courses"), request("/rooms"), request("/timetable/sessions"),
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
      <Link className="btn btn-outline-light btn-sm" href="/">Degree programmes</Link>
    </div></nav>
    <main className="container py-5">
      <header className="timetable-heading mb-4">
        <div><p className="eyebrow mb-2">UNIVERSITY OF CALABRIA / ACADEMIC PLANNING</p>
          <h1 className="display-5 fw-semibold mb-2">Timetable</h1>
          <p className="text-secondary mb-0">Your weekly classes, all in one place.</p></div>
        <div className="schedule-count"><strong>{sessions.length}</strong><span>scheduled classes</span></div>
      </header>
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
