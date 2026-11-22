"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { homeFor, navLinksFor } from "../../lib/auth-rules.js";
import { useAuth } from "./auth-provider.jsx";

// Shows only the links of the signed-in user's role, plus their email and Log out.
export function AppNav({ current }) {
  const { role, email, logOut } = useAuth();
  return <nav className="navbar campus-nav">
    <div className="container"><Link className="navbar-brand" href={role ? homeFor(role) : "/"}><Image src="/unical-logo-white.svg" alt="University of Calabria" width={294} height={24} className="navbar-logo" /></Link>
      <div className="nav-actions">
        {navLinksFor(role).map(([href, label]) => <Link key={href}
          className={`btn btn-outline-light btn-sm${href === current ? " active" : ""}`}
          aria-current={href === current ? "page" : undefined} href={href}>{label}</Link>)}
        {email && <div className="nav-user">
          <span className="nav-user-email" title={email}>{email}</span>
          <button type="button" className="btn btn-light btn-sm" onClick={logOut}>Log out</button>
        </div>}
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
