"use client";

import { useId } from "react";

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export default function SessionDetailsDialog({
  session,
  onClose,
  children,
}) {
  const titleId = useId();

  if (!session) return null;

  const teacherNames = session.teacher_names ?? [];
  const timeRange =
    `${session.start_time.slice(0, 5)}\u2013${session.end_time.slice(0, 5)}`;

  const details = [
    ["Day", WEEKDAYS[session.weekday]],
    ["Time", timeRange],
    ["Room", session.room_code || "Not assigned"],
    ["Degree programme", session.degree_name || "Not assigned"],
    [
      teacherNames.length === 1 ? "Teacher" : "Teachers",
      teacherNames.length ? teacherNames.join(", ") : "Not assigned",
    ],
  ];

  return (
    <div
      className="session-details-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="session-details-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="session-details-heading">
          <div>
            <p className="eyebrow mb-1">TIMETABLE SESSION</p>
            <h2 id={titleId}>{session.course_name || "Course"}</h2>
          </div>
          <button
            type="button"
            className="session-details-close"
            aria-label="Close session details"
            onClick={onClose}
          >
            {"\u00D7"}
          </button>
        </div>

        <dl className="session-details-list">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {children}

        <div className="session-details-actions">
          <button
            type="button"
            className="btn btn-campus"
            onClick={onClose}
          >
            Close details
          </button>
        </div>
      </section>
    </div>
  );
}
