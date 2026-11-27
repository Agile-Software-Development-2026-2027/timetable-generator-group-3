"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, Clock3, Coffee, LayoutGrid } from "lucide-react";
import { AppNav, Notification, useNotification } from "../components/app-shell.jsx";
import { request, toggleId } from "../teachers/teacher-form.mjs";
import { dayBlockTimes, emptySlotForm, slotFormErrors, slotFormFromConfig, slotPayload, slotPreview, weekdays } from "./slot-config.mjs";

const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

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
  // Point to the error message only while it is shown, so screen readers never reference a missing element.
  const describedBy = (field) => (errors[field] ? { "aria-describedby": `${field}-error` } : {});
  const feedback = (field) => errors[field] && <div id={`${field}-error`} className="invalid-feedback d-block">{errors[field]}</div>;

  const blocks = preview ? dayBlockTimes(form).map((item) => ({ ...item, time: clock(item.start) })) : [];
  const teachingBlocks = blocks.filter((item) => !item.inBreak).length;
  const labelEvery = blocks.length > 12 ? Math.ceil(blocks.length / 12) : 1;

  return <div className="campus-app">
    <AppNav current="/settings" />
    <main className="container degrees-main py-4">
      <header className="degrees-heading mb-3">
        <p className="eyebrow mb-2">BACKOFFICE</p>
        <h1 className="display-5 fw-semibold mb-1">Slot configuration</h1>
        <p className="text-secondary mb-0">Choose the working days and the time grid the timetable engine uses.</p>
      </header>
      <Notification notification={notification} onClose={() => notify(null)} />
      {hasTimetable && <p className="slot-warning" role="alert">
        <AlertTriangle size={16} aria-hidden="true" />
        <span><strong>Warning:</strong> Changing the grid will not automatically regenerate existing timetables.</span>
      </p>}
      {loadState === "loading" && <p className="text-secondary">Loading the current configuration…</p>}
      {loadState === "error" && <p className="fw-semibold">The configuration could not be loaded. Check that the API is running, then refresh the page.</p>}
      {loadState === "ready" && <form onSubmit={submit} className="slot-layout" noValidate>
        <section className="slot-card">
          <fieldset className="slot-section" {...describedBy("working_days")}>
            <div className="slot-section-head">
              <span className="slot-section-icon" aria-hidden="true"><CalendarDays size={16} /></span>
              <div><legend className="slot-section-title">Working days</legend>
                <p>Choose the days when classes can be scheduled.</p></div>
            </div>
            <div className="slot-days">
              {weekdays.map(({ value, short }) => <div className="slot-day" key={value}>
                <input id={`day-${value}`} className="slot-day-input" type="checkbox" checked={form.working_days.includes(value)}
                  onChange={() => updateField("working_days", toggleId(form.working_days, value))} />
                <label className="slot-day-chip" htmlFor={`day-${value}`}>{short}</label>
              </div>)}
            </div>
            {feedback("working_days")}
          </fieldset>
          <div className="slot-section">
            <div className="slot-section-head">
              <span className="slot-section-icon" aria-hidden="true"><Clock3 size={16} /></span>
              <div><h2 className="slot-section-title">Daily schedule</h2>
                <p>Teaching hours and the length of one block of the grid.</p></div>
            </div>
            <div className="slot-fields">
              {[["start_time", "Start time"], ["end_time", "End time"]].map(([field, label]) => <div key={field}>
                <label className="form-label" htmlFor={field}>{label}</label>
                <input id={field} type="time" className={fieldClass(field)} value={form[field]} aria-invalid={Boolean(errors[field])}
                  {...describedBy(field)} onChange={(e) => updateField(field, e.target.value)} />
                {feedback(field)}
              </div>)}
              <div>
                <label className="form-label" htmlFor="block_minutes">Block length (minutes)</label>
                <input id="block_minutes" type="number" min="1" step="1" className={fieldClass("block_minutes")} value={form.block_minutes}
                  aria-invalid={Boolean(errors.block_minutes)} {...describedBy("block_minutes")} onChange={(e) => updateField("block_minutes", e.target.value)} />
                {feedback("block_minutes")}
              </div>
            </div>
          </div>
          <div className="slot-section">
            <div className="slot-section-head">
              <span className="slot-section-icon" aria-hidden="true"><Coffee size={16} /></span>
              <div><h2 className="slot-section-title">Lunch break</h2>
                <p>Optional. No class is scheduled in it, and no class runs across it.</p></div>
            </div>
            <div className="slot-fields">
              {[["break_start", "Lunch break start"], ["break_end", "Lunch break end"]].map(([field, label]) => <div key={field}>
                <label className="form-label" htmlFor={field}>{label}</label>
                <input id={field} type="time" className={fieldClass(field)} value={form[field]} aria-invalid={Boolean(errors[field])}
                  {...describedBy(field)} onChange={(e) => updateField(field, e.target.value)} />
                {feedback(field)}
              </div>)}
            </div>
          </div>
          <div className="slot-actions">
            <button className="btn btn-campus" disabled={saving || Boolean(Object.keys(errors).length)}>{saving ? "Saving…" : "Save configuration"}</button>
          </div>
        </section>
        <aside className="slot-card slot-preview-card" aria-label="Grid preview">
          <div className="slot-section-head">
            <span className="slot-section-icon" aria-hidden="true"><LayoutGrid size={16} /></span>
            <div><h2 className="slot-section-title">Grid preview</h2><p>What the timetable engine will use.</p></div>
          </div>
          {preview && <div className="slot-stats">
            <div><span>Slots per day</span><strong>{teachingBlocks}</strong></div>
            <div><span>Working days</span><strong>{form.working_days.length}</strong></div>
            <div><span>Total slots</span><strong>{teachingBlocks * form.working_days.length}</strong></div>
          </div>}
          {preview && <div className="slot-day-bar" aria-hidden="true">
            {blocks.map((item, i) => <div className={`slot-block${item.inBreak ? " slot-block-break" : ""}`} key={item.time}
              title={item.inBreak ? "Lunch break" : undefined}>
              <span>{i % labelEvery === 0 ? item.time : ""}</span>
            </div>)}
            <div className="slot-block-end"><span>{form.end_time}</span></div>
          </div>}
          <p className="settings-preview" role="status" aria-live="polite">
            {preview ?? "Fix the highlighted fields to see the grid preview."}
          </p>
        </aside>
      </form>}
    </main>
  </div>;
}
