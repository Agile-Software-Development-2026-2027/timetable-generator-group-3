"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";

// Single source of truth for the header: every page renders all of these, in
// this order, so buttons never shift or disappear when navigating.
export const NAV_LINKS = [["/", "Degree programmes"], ["/rooms", "Rooms"], ["/teachers", "Teachers"], ["/courses", "Courses"], ["/data-loader", "Data Loader"], ["/calendar", "Open timetable"], ["/settings", "Slot configuration"]];

export function AppNav({ current }) {
  return <nav className="navbar campus-nav">
    <div className="container"><Link className="navbar-brand" href="/"><Image src="/unical-logo-white.svg" alt="University of Calabria" width={294} height={24} className="navbar-logo" /></Link>
      <div className="nav-actions">
        {NAV_LINKS.map(([href, label]) => <Link key={href}
          className={`btn btn-outline-light btn-sm${href === current ? " active" : ""}`}
          aria-current={href === current ? "page" : undefined} href={href}>{label}</Link>)}
      </div>
    </div>
  </nav>;
}

export function Notification({ notification, onClose }) {
  if (!notification) return null;
  return <div className={`app-notification app-notification-${notification.type}`} role={notification.type === "error" ? "alert" : "status"} aria-live="polite">
    <span className="notification-icon" aria-hidden="true">{notification.type === "success" ? "✓" : "!"}</span>
    <p className="notification-text">{notification.text}</p>
    <button type="button" className="notification-close" aria-label="Dismiss notification" onClick={onClose}>×</button>
  </div>;
}

export function useNotification() {
  const [notification, setNotification] = useState(null);
  useEffect(() => {
    if (!notification) return undefined;
    const timeout = window.setTimeout(() => setNotification(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notification]);
  return [notification, (text, type = "error") => setNotification(text ? { text, type } : null)];
}
