"use client";

import { useEffect, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import listPlugin from "@fullcalendar/react/list";
import breezyThemePlugin from "@fullcalendar/react/themes/breezy";
import {
  DEFAULT_SLOT_CONFIG,
  getCalendarVisibleRange,
  getCalendarTimeRange,
  getCalendarWeekSettings,
  getResponsiveCalendarView,
  getCourseColors,
} from "../calendar/sessions.mjs";


function sessionToEvent(session) {
  const [background, color] = getCourseColors(session.course_id);

  const courseName = session.course_name || "Course";
  const roomCode = session.room_code || "Room not assigned";
  const teacherNames = session.teacher_names?.length
    ? session.teacher_names.join(", ")
    : "Teacher not assigned";
  const timeRange = `${session.start_time.slice(0, 5)} - ${session.end_time.slice(0, 5)}`;

  return {
    id: String(session.id),
    title: `${courseName} | ${roomCode} | ${timeRange} | ${teacherNames}`,
    daysOfWeek: [(session.weekday + 1) % 7],
    startTime: session.start_time,
    endTime: session.end_time,
    backgroundColor: background,
    borderColor: color,
    textColor: color,
    extendedProps: {
      courseName,
      roomCode,
      teacherNames,
      timeRange,
      background,
      color,
    },
  };
}

function renderSession(info) {
  const { courseName, roomCode, teacherNames, timeRange, background, color } =
    info.event.extendedProps;

  return (
    <div
      className="calendar-event-content student-course-event"
      style={{
        "--course-background": background,
        "--course-color": color,
      }}
    >
      <strong className="calendar-event-title" title={courseName}>
        {courseName}
      </strong>
      <span className="calendar-event-detail">{timeRange}</span>
      <span className="calendar-event-detail">{roomCode}</span>
      <span className="calendar-event-teachers">{teacherNames}</span>
    </div>
  );
}

export default function StudentCalendar({
  sessions = [],
  slotConfig = DEFAULT_SLOT_CONFIG,
}) {
  const calendarRef = useRef(null);

  useEffect(() => {
    function syncCalendarView() {
      const calendar = calendarRef.current?.getApi();
      if (!calendar) return;

      const nextView = getResponsiveCalendarView(
        calendar.view.type,
        window.innerWidth < 768
      );

      if (nextView) calendar.changeView(nextView);
    }

    syncCalendarView();
    window.addEventListener("resize", syncCalendarView);

    return () => window.removeEventListener("resize", syncCalendarView);
  }, []);

  const workingDays = [...new Set([
    ...slotConfig.working_days,
    ...sessions.map((session) => session.weekday),
  ])].sort((first, second) => first - second);

  const { firstDay, hiddenDays } = getCalendarWeekSettings(workingDays);
  const visibleRange = getCalendarVisibleRange(slotConfig);
  const sessionRange = getCalendarTimeRange(sessions, slotConfig);
  const slotMinTime = [visibleRange.min, sessionRange.min].sort()[0];
  const slotMaxTime = [visibleRange.max, sessionRange.max].sort().at(-1);
  const events = sessions.map(sessionToEvent);

  return (
    <section
      className="card campus-card timetable-card"
      aria-label="Personal weekly timetable"
    >
      <div className="timetable-calendar-heading">
        <div>
          <h2>Weekly timetable</h2>
          <p>Your scheduled classes, rooms and teachers.</p>
        </div>
        <div className="schedule-count" aria-live="polite">
          <strong>{sessions.length}</strong>
          <span>
            {sessions.length === 1 ? "scheduled class" : "scheduled classes"}
          </span>
        </div>
      </div>

      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, listPlugin, breezyThemePlugin]}
        initialView="timeGridWeek"
        firstDay={firstDay}
        hiddenDays={hiddenDays}
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "timeGridWeek,timeGridDay,listWeek",
        }}
        buttonText={{
          today: "Today",
          week: "Week",
          day: "Day",
          list: "List",
        }}
        events={events}
        editable={false}
        selectable={false}
        eventStartEditable={false}
        eventDurationEditable={false}
        droppable={false}
        allDaySlot={false}
        slotMinTime={slotMinTime}
        slotMaxTime={slotMaxTime}
        slotDuration="00:30:00"
        slotHeaderInterval="01:00:00"
        slotMinHeight={34}
        slotEventOverlap={false}
        eventClass="timetable-session-event"
        slotLaneClass="calendar-empty-slot"
        height="auto"
        nowIndicator
        eventContent={renderSession}
      />
    </section>
  );
}
