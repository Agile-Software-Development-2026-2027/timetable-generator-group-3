"use client";

import { useId, useState } from "react";
import Link from "next/link";

const WARNING_LABELS = {
  missing_teacher: "Missing teacher",
  room_capacity: "Room capacity",
  missing_lab: "Laboratory requirement",
  missing_projector: "Projector requirement",
  room_suitability: "Room suitability",
  semester_capacity: "Semester capacity",
  teacher_unavailable: "Teacher availability",
  teacher_workload: "Teacher workload",
};

export function groupPreflightWarnings(warnings) {
  const groups = new Map();

  for (const warning of warnings) {
    if (!groups.has(warning.type)) {
      groups.set(warning.type, []);
    }

    groups.get(warning.type).push(warning);
  }

  return Array.from(groups, ([type, items]) => ({
    type,
    label: WARNING_LABELS[type] || type.replace(/_/g, " "),
    warnings: items,
  }));
}

export function preflightWarningLink(warning) {
  if (Number.isSafeInteger(warning.course_id) && warning.course_id > 0) {
    const assign = warning.type === "missing_teacher";

    return {
      href: `/courses?${assign ? "assign" : "edit"}=${warning.course_id}`,
      label: assign ? "Assign teachers" : "Edit course",
    };
  }

  if (Number.isSafeInteger(warning.teacher_id) && warning.teacher_id > 0) {
    return {
      href: `/teachers?edit=${warning.teacher_id}`,
      label: "Edit teacher",
    };
  }

  return null;
}

function WarningLink({ warning }) {
  const link = preflightWarningLink(warning);

  if (!link) return null;

  return (
    <Link
      href={link.href}
      className="small d-inline-block mt-1"
    >
      {link.label}
    </Link>
  );
}

export function PreflightPanel({ warnings }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  const errorCount = warnings.filter(
    (warning) => warning.severity === "error"
  ).length;

  const warningCount = warnings.length - errorCount;
  const groups = groupPreflightWarnings(warnings);

  if (warnings.length === 0) return null;

  return (
    <div className="d-inline-flex">
      <button
        type="button"
        className="btn btn-campus rounded-start-0"
        aria-label={`Pre-generation warnings: ${warnings.length}`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={`badge rounded-pill ${
          errorCount > 0
            ? "bg-danger border border-light"
            : "bg-warning text-dark"
        }`}>
          {warnings.length}
        </span>
      </button>

      <div
        className="generation-confirm-backdrop"
        role="presentation"
        hidden={!expanded}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setExpanded(false);
        }}
      >
      <section id={panelId}
        className="generation-confirm-dialog"
        aria-label="Pre-generation warnings"
      >
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-start mb-3">
            <div>
              <h3 className="h6 mb-1">Pre-generation warnings</h3>
              <p className="small text-muted mb-0">
                Review these issues before generating your timetable.
              </p>
            </div>

            <button
              type="button"
              className="btn-close"
              aria-label="Close pre-generation warnings"
              onClick={() => setExpanded(false)}
            />
          </div>

          <div className="d-flex gap-2 mb-3">
            <span className="badge bg-danger">
              {errorCount} {errorCount === 1 ? "error" : "errors"}
            </span>
            <span className="badge bg-warning text-dark">
              {warningCount} {warningCount === 1 ? "warning" : "warnings"}
            </span>
          </div>

          {groups.map((group) => (
            <section
              key={group.type}
              className="border-top pt-3 mb-3"
            >
              <h4 className="h6">
                {group.label} ({group.warnings.length})
              </h4>

              <ul className="list-unstyled mb-0">
                {group.warnings.map((warning, index) => (
                  <li
                    key={`${warning.course_id ?? ""}-${warning.teacher_id ?? ""}-${index}`}
                    className="d-flex align-items-start gap-2 mb-2"
                  >
                    <span
                      className={`badge ${
                        warning.severity === "error"
                          ? "bg-danger"
                          : "bg-warning text-dark"
                      }`}
                    >
                      {warning.severity === "error" ? "Error" : "Warning"}
                    </span>
                    <div className="small">
                      <div>{warning.message}</div>
                      <WarningLink warning={warning} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
    </div>
  );
}