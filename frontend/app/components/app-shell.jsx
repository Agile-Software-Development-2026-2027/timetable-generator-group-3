"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function AppNav({ current }) {
  const links = [["/", "Degree programmes"], ["/rooms", "Rooms"], ["/teachers", "Teachers"], ["/courses", "Courses"], ["/data-loader", "Data Loader"], ["/calendar", "Open timetable"]];
  return <nav className="navbar campus-nav">
    <div className="container"><Link className="navbar-brand" href="/">UNICAL <span>UNIVERSITY OF CALABRIA</span></Link>
      <div className="nav-actions">
        {links.filter(([href]) => href !== current).map(([href, label]) => <Link key={href} className="btn btn-outline-light btn-sm" href={href}>{label}</Link>)}
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
