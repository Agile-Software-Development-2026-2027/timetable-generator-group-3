"use client";

import { useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const MAX_SIZE = 256 * 1024;

// The API uses {file, database}; support older preview payloads as well.
// Never render a missing property as the literal word "undefined".
function displayRoomValue(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  if (value === null || value === undefined) return "unavailable";
  return String(value);
}

function normalizeRoomConflicts(conflicts, dataset) {
  if (!Array.isArray(conflicts)) return [];
  return conflicts.map((conflict) => {
    const room = dataset?.rooms?.find((item) => item.code === conflict.code);
    const differences = Object.entries(conflict.differences || {}).map(([field, raw]) => {
      const objectValue = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      // The uploaded JSON is the most reliable source for the file column.
      const fileValue = room && Object.prototype.hasOwnProperty.call(room, field)
        ? room[field]
        : objectValue.file ?? objectValue.json ?? objectValue.dataset ?? (Array.isArray(raw) ? raw[0] : undefined);
      const dbValue = Object.prototype.hasOwnProperty.call(objectValue, "database")
        ? objectValue.database
        : Object.prototype.hasOwnProperty.call(objectValue, "db")
          ? objectValue.db
          : Object.prototype.hasOwnProperty.call(objectValue, "existing")
            ? objectValue.existing
            : (Array.isArray(raw) ? raw[1] : undefined);
      return { field, fileValue, dbValue };
    });
    return { code: conflict.code, differences };
  });
}

export default function SeedImporter({ onImported }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [dataset, setDataset] = useState(null);
  const [preview, setPreview] = useState(null);
  const [roomConflicts, setRoomConflicts] = useState([]);
  const [reuseRooms, setReuseRooms] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Show dismissible, timed notifications instead of static inline alerts.
  useEffect(() => {
    if (!error && !success) return undefined;
    const timeout = window.setTimeout(() => { setError(""); setSuccess(""); }, 8000);
    return () => window.clearTimeout(timeout);
  }, [error, success]);
  const input = useRef(null);
  function close() {
    if (busy) return;
    setOpen(false);
    setFile(null);
    setDataset(null);
    setPreview(null);
    setRoomConflicts([]);
    setReuseRooms(false);
    setError("");
    setSuccess("");
    setConfirming(false);
  }
  async function selectFile(event) {
    const chosen = event.target.files?.[0];
    setFile(null); setDataset(null); setPreview(null); setRoomConflicts([]); setReuseRooms(false); setError(""); setSuccess(""); setConfirming(false);
    if (!chosen) return;
    if (!chosen.name.toLowerCase().endsWith(".json") || chosen.size > MAX_SIZE) {
      setError("Select a .json file no larger than 256 KB.");
      return;
    }
    try {
      const parsed = JSON.parse(await chosen.text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Expected a JSON object.");
      }
      setFile(chosen);
      setDataset(parsed);
    } catch (err) { setError(`Invalid JSON: ${err.message}`); }
  }
  async function send(endpoint) {
    const url = endpoint === "import" && reuseRooms ? "import?reuse_existing_rooms=true" : endpoint;
    const response = await fetch(`${API}/seed/${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dataset),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || `Request failed (${response.status}).`);
    return body;
  }
  async function verify() {
    setBusy(true); setError(""); setSuccess(""); setPreview(null);
    try {
      const result = await send("validate");
      setPreview(result.summary);
      setRoomConflicts(normalizeRoomConflicts(result.room_conflicts, dataset));
      setReuseRooms(false);
    }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function performImport() {
    setConfirming(false);
    setBusy(true); setError("");
    try {
      const result = await send("import");
      setSuccess(result.message);
      await onImported?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="btn btn-seed-import" onClick={() => setOpen(true)}>
      <span aria-hidden="true">⇧</span> Import JSON
    </button>
    {open && <div className="delete-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section className="degree-form-modal seed-import-modal" role="dialog" aria-modal="true" aria-labelledby="seed-title">
        <div className="degree-form-modal-header">
          <div><p className="eyebrow mb-1">ACADEMIC DATA</p><h2 id="seed-title" className="h4 mb-0">Manual Data Loader</h2></div>
          <button type="button" className="degree-modal-close" aria-label="Close importer" disabled={busy} onClick={close}>×</button>
        </div>
        <p className="text-secondary small">Import a degree, its courses, teachers, and rooms from a validated JSON file.</p>
        <input ref={input} type="file" accept=".json,application/json" className="visually-hidden" onChange={selectFile} />
        <button type="button" className="seed-file-picker" disabled={busy} onClick={() => input.current?.click()}>
          <span className="seed-file-icon" aria-hidden="true">{file ? "✓" : "⇧"}</span>
          <strong>{file ? file.name : "Browse JSON file"}</strong>
          <small>{file ? `${(file.size / 1024).toFixed(1)} KB selected` : "Choose a prepared degree dataset (.json, max 256 KB)"}</small>
        </button>
        {preview && <div className="seed-preview" aria-live="polite">
          <strong>{preview.degree}</strong>
          <div className="seed-metrics">
            {[["Years", preview.years], ["Semesters", preview.semesters], ["Courses", preview.courses],
              ["Teachers", preview.teachers], ["Rooms", preview.rooms]].map(([name, count]) =>
              <span key={name}><strong>{count}</strong><small>{name}</small></span>)}
          </div>
          <small>JSON validated. Existing room attributes were checked against the database.</small>
          {roomConflicts.length > 0 && <div className="seed-conflicts">
            <strong>{roomConflicts.length} room(s) differ from the database</strong>
            <p className="mb-2">Shared rooms already exist with different values. Review before importing.</p>
            <ul>{roomConflicts.map(({ code, differences }) =>
              <li key={code}><strong>{code}</strong>: {differences.map(({ field, fileValue, dbValue }) =>
                `${field} (file: ${displayRoomValue(fileValue)}, DB: ${displayRoomValue(dbValue)})`).join("; ")}</li>
            )}</ul>
            <label className="d-flex align-items-start gap-2">
              <input type="checkbox" className="form-check-input" checked={reuseRooms}
                onChange={event => setReuseRooms(event.target.checked)} />
              <span>Reuse existing database room properties without overwriting them.</span>
            </label>
          </div>}
        </div>}
        {(error || success) && <div className={`seed-toast ${error ? "seed-toast-error" : "seed-toast-success"}`}
          role={error ? "alert" : "status"} aria-live="assertive">
          <span className="seed-toast-symbol" aria-hidden="true">{error ? "!" : "✓"}</span>
          <div><strong>{error ? "Import could not be completed" : "Import successful"}</strong>
            <p>{error || success}</p></div>
          <button type="button" aria-label="Dismiss message" onClick={() => { setError(""); setSuccess(""); }}>×</button>
        </div>}
        <div className="degree-form-modal-actions mt-3">
          <button className="btn btn-light" type="button" disabled={busy} onClick={close}>Close</button>
          <button className="btn btn-outline-secondary" type="button" disabled={!dataset || busy || !!success} onClick={verify}>
            {busy ? "Working…" : "Validate"}
          </button>
          <button className="btn btn-campus" type="button" disabled={!preview || busy || !!success || (roomConflicts.length > 0 && !reuseRooms)} onClick={() => setConfirming(true)}>
            Import dataset
          </button>
        </div>
      </section>
      {confirming && <div className="seed-confirm-backdrop" role="presentation">
        <section className="seed-confirm-card" role="alertdialog" aria-modal="true"
          aria-labelledby="seed-confirm-title" aria-describedby="seed-confirm-description">
          <div className="seed-confirm-icon" aria-hidden="true">!</div>
          <h3 id="seed-confirm-title">Confirm database import</h3>
          <p id="seed-confirm-description">Import <strong>{preview?.degree}</strong> into the configured database?
            Matching records will be reused. {roomConflicts.length > 0
              ? `${roomConflicts.length} existing room(s) will retain their database properties, even where the JSON differs.`
              : "Any new database conflicts will cancel the import."} No existing records will be overwritten.</p>
          <div className="seed-confirm-actions">
            <button type="button" className="btn btn-light" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="btn btn-campus" disabled={busy} onClick={performImport}>Yes, import data</button>
          </div>
        </section>
      </div>}
    </div>}
  </>;
}
