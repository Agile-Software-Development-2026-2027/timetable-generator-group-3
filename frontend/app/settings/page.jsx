"use client";

import { useEffect, useState } from "react";
import { AppNav, Notification, useNotification } from "../components/app-shell.jsx";
import { request, toggleId } from "../teachers/teacher-form.mjs";
import { emptySlotForm, slotFormErrors, slotFormFromConfig, slotPayload, slotPreview, weekdays } from "./slot-config.mjs";

export default function SettingsPage() {
  const [form, setForm] = useState(emptySlotForm);
  const [loadState, setLoadState] = useState("loading");
  const [hasTimetable, setHasTimetable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notification, notify] = useNotification();

  useEffect(() => {
    request("/slot-config")
      .then((config) => { setForm(slotFormFromConfig(config)); setLoadState("ready"); })
      .catch((error) => { setLoadState("error"); notify(error.message); });
    // The banner is only a hint: if this check fails, the page still works.
    request("/timetable/sessions?page_size=1")
      .then((sessions) => setHasTimetable(sessions.length > 0))
      .catch(() => setHasTimetable(false));
  }, []);

  const errors = slotFormErrors(form);
  const preview = slotPreview(form);

  function updateField(field, value) {
    setForm({ ...form, [field]: value });
  }

  async function submit(event) {
    event.preventDefault();
    if (Object.keys(errors).length) return;
    setSaving(true);
    try {
      const saved = await request("/slot-config", { method: "PUT", body: JSON.stringify(slotPayload(form)) });
      setForm(slotFormFromConfig(saved));
      notify("Slot configuration saved.", "success");
    } catch (error) {
      notify(error.message);
    } finally {
      setSaving(false);
    }
  }

  const fieldClass = (field) => `form-control ${errors[field] ? "is-invalid" : ""}`;
  const feedback = (field) => errors[field] && <div id={`${field}-error`} className="invalid-feedback d-block">{errors[field]}</div>;

  return <div className="campus-app">
    <AppNav current="/settings" />
    <main className="container degrees-main py-4">
      <header className="degrees-heading mb-3">
        <p className="eyebrow mb-2">BACKOFFICE</p>
        <h1 className="display-5 fw-semibold mb-1">Slot configuration</h1>
        <p className="text-secondary mb-0">Choose the working days and the time grid the timetable engine uses.</p>
      </header>
      <Notification notification={notification} onClose={() => notify(null)} />
      {hasTimetable && <p className="delete-modal-warning" role="alert">
        <strong>Warning:</strong> Changing the grid will not automatically regenerate existing timetables.
      </p>}
      {loadState === "loading" && <p className="text-secondary">Loading the current configuration…</p>}
      {loadState === "error" && <p className="fw-semibold">The configuration could not be loaded. Check that the API is running, then refresh the page.</p>}
      {loadState === "ready" && <section className="room-table-panel settings-panel">
        <form onSubmit={submit} className="d-grid gap-3" noValidate>
          <fieldset aria-describedby="working_days-error">
            <legend className="form-label">Working days</legend>
            <div className="settings-days">
              {weekdays.map(({ value, short }) => <div className="form-check form-check-inline" key={value}>
                <input id={`day-${value}`} className="form-check-input" type="checkbox" checked={form.working_days.includes(value)}
                  onChange={() => updateField("working_days", toggleId(form.working_days, value))} />
                <label className="form-check-label" htmlFor={`day-${value}`}>{short}</label>
              </div>)}
            </div>
            {feedback("working_days")}
          </fieldset>
          <div className="row g-3">
            {[["start_time", "Start time"], ["end_time", "End time"]].map(([field, label]) => <div className="col-sm-4" key={field}>
              <label className="form-label" htmlFor={field}>{label}</label>
              <input id={field} type="time" className={fieldClass(field)} value={form[field]} aria-invalid={Boolean(errors[field])}
                aria-describedby={`${field}-error`} onChange={(e) => updateField(field, e.target.value)} />
              {feedback(field)}
            </div>)}
            <div className="col-sm-4">
              <label className="form-label" htmlFor="block_minutes">Block length (minutes)</label>
              <input id="block_minutes" type="number" min="1" step="1" className={fieldClass("block_minutes")} value={form.block_minutes}
                aria-invalid={Boolean(errors.block_minutes)} aria-describedby="block_minutes-error" onChange={(e) => updateField("block_minutes", e.target.value)} />
              {feedback("block_minutes")}
            </div>
          </div>
          <p className="settings-preview" role="status" aria-live="polite">
            {preview ?? "Fix the highlighted fields to see the grid preview."}
          </p>
          <div className="d-flex justify-content-end">
            <button className="btn btn-campus" disabled={saving || Boolean(Object.keys(errors).length)}>{saving ? "Saving…" : "Save configuration"}</button>
          </div>
        </form>
      </section>}
    </main>
  </div>;
}
