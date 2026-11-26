"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { homeFor, navLinksFor } from "../../lib/auth-rules.js";
import { ArrowDownToLine, BookOpen, Building2, CalendarDays, ChevronRight, GraduationCap, LayoutDashboard, LogOut, Menu, School, Settings2, UserCog, Users, X } from "lucide-react";
import { useAuth } from "./auth-provider.jsx";

const NAV_ICONS = {
  "/": School, "/rooms": Building2, "/teachers": Users, "/students": GraduationCap, "/courses": BookOpen,
  "/data-loader": ArrowDownToLine, "/calendar": CalendarDays, "/settings": Settings2,
  "/my-schedule": CalendarDays, "/my-timetable": CalendarDays, "/my-courses": GraduationCap, "/users": UserCog,
};

const ROLE_LABELS = { director: "Programme director", teacher: "Teacher", student: "Student" };

function initialsOf(email) {
  const name = (email ?? "").split("@")[0];
  const parts = name.split(/[._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// Sidebar and top bar shared by every page. A role only ever sees its own links,
// always in the same order, plus its email and Log out.
export function AppNav({ current }) {
  const { role, email, logOut } = useAuth();
  const [open, setOpen] = useState(false);
  const links = navLinksFor(role);
  const currentLabel = links.find(([href]) => href === current)?.[1];
  return <>
    <aside className={`sidebar${open ? " nav-open" : ""}`}>
      <nav className="sidebar-inner" aria-label="Main navigation">
        <div className="sidebar-brand">
          <Link className="brand-link" href={role ? homeFor(role) : "/"} aria-label="University of Calabria">
            <Image src="/unical-logo-white.svg" alt="" width={196} height={16} className="brand-logo" />
          </Link>
          <button type="button" className="mobile-close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={20} /></button>
        </div>
        {links.length > 0 && <>
          <div className="workspace-label">{role === "director" ? "MANAGEMENT" : "YOUR SPACE"}</div>
          <div className="side-nav">
            {links.map(([href, label]) => {
              const Icon = NAV_ICONS[href] ?? LayoutDashboard;
              const active = href === current;
              return <Link key={href} href={href} className={`nav-item${active ? " nav-active" : ""}`}
                aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>
                <Icon size={17} aria-hidden="true" /><span>{label}</span>
              </Link>;
            })}
          </div>
        </>}
        {email && <div className="sidebar-bottom">
          <div className="sidebar-user">
            <div className="avatar user-avatar" aria-hidden="true">{initialsOf(email)}</div>
            <div className="user-details"><strong title={email}>{email}</strong><span>{ROLE_LABELS[role] ?? "No role"}</span></div>
            <button type="button" className="logout-button" aria-label="Log out" title="Log out" onClick={logOut}><LogOut size={16} /></button>
          </div>
        </div>}
      </nav>
    </aside>
    {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} />}
    <header className="topbar">
      <button type="button" className="mobile-menu" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu size={20} /></button>
      <div className="breadcrumb">Workspace <ChevronRight size={14} aria-hidden="true" /><strong>{currentLabel ?? "Timetable Generator"}</strong></div>
      {role && <div className="topbar-right"><span className="role-chip"><span className="role-dot" />{ROLE_LABELS[role]}</span></div>}
    </header>
  </>;
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
