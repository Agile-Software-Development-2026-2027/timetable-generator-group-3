"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Clock3, Sun } from "lucide-react";
import { Notification, useNotification } from "./app-shell.jsx";
import { apiRequest } from "../../lib/api.js";
import {
  fetchTeacherPreferences,
  saveTeacherPreferences,
} from "../../lib/teacher-preferences-api.js";

const numericFields = [
  ["max_hours_per_day", "Max hours per day"],
  ["max_teaching_days", "Max teaching days"],
  ["max_consecutive_hours", "Max consecutive hours"],
];

function formFromPreferences(preferences) {
  return {
    max_hours_per_day: String(preferences.max_hours_per_day ?? ""),
    max_teaching_days: String(preferences.max_teaching_days ?? ""),
    max_consecutive_hours: String(preferences.max_consecutive_hours ?? ""),
    preferred_part_of_day: preferences.preferred_part_of_day ?? "none",
  };
}

function formErrors(form, maxDays) {
  const errors = {};

  for (const [field] of numericFields) {
    if (form[field] === "") continue;

    const value = Number(form[field]);

    if (!Number.isSafeInteger(value) || value <= 0) {
      errors[field] = "Enter a positive whole number.";
    } else if (field === "max_teaching_days" && value > maxDays) {
      errors[field] = `Enter no more than ${maxDays} teaching days.`;
    }
  }

  return errors;
}

function preferencesPayload(form) {
  return {
    max_hours_per_day: form.max_hours_per_day === ""
      ? null : Number(form.max_hours_per_day),
    max_teaching_days: form.max_teaching_days === ""
      ? null : Number(form.max_teaching_days),
    max_consecutive_hours: form.max_consecutive_hours === ""
      ? null : Number(form.max_consecutive_hours),
    preferred_part_of_day: form.preferred_part_of_day,
  };
}

function PreferencesEditor({ teacherId }) {
  const id = useId();
  const active = useRef(false);
  const pending = useRef(false);
  const [form, setForm] = useState(() => formFromPreferences({}));
  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [maxDays, setMaxDays] = useState(6);
  const [saving, setSaving] = useState(false);
  const [notification, notify] = useNotification();

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetchTeacherPreferences(teacherId),
      apiRequest("/slot-config"),
    ]).then(([preferences, config]) => {
      if (cancelled) return;

      if (!Array.isArray(config?.working_days) ||
          config.working_days.length === 0) {
        throw new Error("Invalid working days configuration.");
      }

      if (!preferences || typeof preferences !== "object" ||
          Array.isArray(preferences)) {
        throw new Error("Invalid workload preferences response.");
      }

      setForm(formFromPreferences(preferences));
      setMaxDays(Math.min(6, config.working_days.length));
      setLoadState("ready");
    }).catch((error) => {
      if (cancelled) return;
      setLoadError(error.message || "Could not load workload preferences.");
      setLoadState("error");
    });

    return () => { cancelled = true; };
  }, [teacherId, attempt]);

  const errors = formErrors(form, maxDays);
  const invalid = Object.keys(errors).length > 0;

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function retry() {
    setLoadError("");
    setLoadState("loading");
    setAttempt((current) => current + 1);
  }

  async function submit(event) {
    event.preventDefault();

    if (pending.current || invalid || loadState !== "ready") return;

    pending.current = true;
    setSaving(true);
    notify(null);

    try {
      const saved = await saveTeacherPreferences(
        teacherId, preferencesPayload(form)
      );

      if (!active.current) return;

      setForm(formFromPreferences(saved));
      notify("Workload preferences saved.", "success");
    } catch (error) {
      if (active.current) {
        notify(error.message || "Could not save workload preferences.");
      }
    } finally {
      pending.current = false;
      if (active.current) setSaving(false);
    }
  }

  return (
    <section className="slot-card mb-3" aria-labelledby={`${id}-heading`}>
      <Notification notification={notification} onClose={() => notify(null)} />

      <div className="slot-section">
        <div className="slot-section-head">
          <span className="slot-section-icon" aria-hidden="true">
            <Clock3 size={16} />
          </span>
          <div>
            <h2 id={`${id}-heading`} className="slot-section-title">
              Workload preferences
            </h2>
            <p>Set optional limits for your teaching schedule.</p>
          </div>
        </div>

        {loadState === "loading" && (
          <p className="text-secondary small mb-0" role="status">
            Loading workload preferences...
          </p>
        )}

        {loadState === "error" && (
          <>
            <p className="text-danger small" role="alert">{loadError}</p>
            <button type="button" className="btn btn-outline-secondary" onClick={retry}>
              Retry
            </button>
          </>
        )}

        {loadState === "ready" && (
          <p className="text-secondary small mb-0">
            Leave a limit empty if you do not want to restrict it.
          </p>
        )}
      </div>

      {loadState === "ready" && (
        <form onSubmit={submit} noValidate>
          <div className="slot-section">
            <div className="slot-fields">
              {numericFields.map(([field, label]) => (
                <div key={field}>
                  <label className="form-label" htmlFor={`${id}-${field}`}>
                    {label}
                  </label>
                  <input
                    id={`${id}-${field}`}
                    type="number"
                    min="1"
                    step="1"
                    max={field === "max_teaching_days" ? maxDays : undefined}
                    className={`form-control${errors[field] ? " is-invalid" : ""}`}
                    placeholder="No limit"
                    value={form[field]}
                    disabled={saving}
                    aria-invalid={Boolean(errors[field])}
                    aria-describedby={errors[field] ? `${id}-${field}-error` : undefined}
                    onChange={(event) => updateField(field, event.target.value)}
                  />
                  {errors[field] && (
                    <div id={`${id}-${field}-error`} className="invalid-feedback d-block">
                      {errors[field]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="slot-section">
            <div className="slot-section-head">
              <span className="slot-section-icon" aria-hidden="true">
                <Sun size={16} />
              </span>
              <div>
                <h3 className="slot-section-title">Preferred time of day</h3>
                <p>The timetable engine will try to respect your preference.</p>
              </div>
            </div>

            <div className="slot-fields">
              <div>
                <label className="form-label" htmlFor={`${id}-preferred-part`}>
                  Preferred part of day
                </label>
                <select
                  id={`${id}-preferred-part`}
                  className="form-select"
                  value={form.preferred_part_of_day}
                  disabled={saving}
                  onChange={(event) => updateField("preferred_part_of_day", event.target.value)}
                >
                  <option value="none">No preference</option>
                  <option value="morning">Morning (before 13:00)</option>
                  <option value="afternoon">Afternoon (from 13:00)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="slot-actions">
            <button
              type="submit"
              className="btn btn-campus"
              disabled={saving || invalid}
            >
              {saving ? "Saving..." : "Save preferences"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export default function WorkloadPreferencesForm({ teacherId }) {
  if (!Number.isSafeInteger(teacherId) || teacherId <= 0) {
    return null;
  }

  return <PreferencesEditor key={teacherId} teacherId={teacherId} />;
}
