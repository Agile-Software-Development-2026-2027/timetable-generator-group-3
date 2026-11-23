"use client";

import { AppNav } from "./app-shell.jsx";

// Stands in for the teacher and student home pages until KAN-58 and KAN-59 build them.
export function RolePlaceholder({ path, title, text }) {
  return <div className="campus-app">
    <AppNav current={path} />
    <main className="container degrees-main py-4">
      <header className="degrees-heading mb-3">
        <p className="eyebrow mb-2">UNIVERSITY OF CALABRIA / TIMETABLE</p>
        <h1 className="display-5 fw-semibold mb-1">{title}</h1>
        <p className="text-secondary mb-0">{text}</p>
      </header>
      <div className="empty-calendar">
        <span className="empty-calendar-icon" aria-hidden="true">▦</span>
        <span><strong>Coming soon</strong><small>This page is still being built.</small></span>
      </div>
    </main>
  </div>;
}
