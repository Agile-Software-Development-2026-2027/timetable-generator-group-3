"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api.js";

export function PublicationPanel({ degreeId, degreeName, revision = 0 }) {
  const [role, setRole] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest("/auth/me")
      .then((user) => { if (active) setRole(user.role); })
      .catch(() => { if (active) setRole(null); });
    return () => { active = false; };
  }, []);

  // Close the dialogs when the degree or the timetable changes, but not when the
  // user's role arrives: that closed a dialog the user had just opened.
  useEffect(() => {
    setConfirmOpen(false);
    setInfoOpen(false);
  }, [degreeId, revision]);

  useEffect(() => {
    let active = true;
    setStatus(null);
    setError("");
    if (!degreeId || role !== "director") return () => { active = false; };
    setLoading(true);
    apiRequest(`/timetable/publication?degree_id=${encodeURIComponent(degreeId)}`)
      .then((result) => { if (active) setStatus(result); })
      .catch((cause) => { if (active) setError(`Could not load publication status: ${cause.message}`); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [degreeId, role, revision]);

  useEffect(() => {
    if (!infoOpen) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") setInfoOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [infoOpen]);

  async function publish() {
    if (!degreeId || publishing) return;
    setPublishing(true);
    setError("");
    try {
      const result = await apiRequest(
        `/timetable/publish?degree_id=${encodeURIComponent(degreeId)}`,
        { method: "POST" }
      );
      setStatus(result);
      setConfirmOpen(false);
    } catch (cause) {
      setError(`Could not publish timetable: ${cause.message}`);
    } finally {
      setPublishing(false);
    }
  }

  if (role !== "director") return null;
  const publishedDate = status?.published_at
    ? new Date(status.published_at).toLocaleString()
    : null;

  return (
    <section className="timetable-publication-inline" aria-label="Timetable publication">
      <div className="timetable-publication-actions">
        {status && (
          <button type="button" className="btn btn-outline-primary timetable-publication-publish"
            disabled={!degreeId || loading || publishing}
            onClick={() => setConfirmOpen(true)}>
            Publish
          </button>
        )}
        <button type="button" className="btn timetable-publication-toggle"
          aria-haspopup="dialog" onClick={() => setInfoOpen(true)}>
          Show publication info
        </button>
      </div>
      {infoOpen && (
        <div className="generation-confirm-backdrop publication-info-backdrop" role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setInfoOpen(false);
          }}>
          <section className="generation-confirm-dialog publication-info-dialog" role="dialog"
            aria-modal="true" aria-labelledby="publication-info-title">
            <button type="button" className="session-details-close publication-info-close"
              aria-label="Close publication info" autoFocus onClick={() => setInfoOpen(false)}>
              ×
            </button>
            <p className="eyebrow">TIMETABLE PUBLICATION</p>
            <h2 id="publication-info-title">Publication information</h2>
            <div className="publication-info-content">
              <span className="badge text-bg-secondary" role="status">
                {loading ? "Checking publication status…"
                  : !status ? "Publication status unavailable"
                    : publishedDate ? `Published on ${publishedDate}`
                      : "Draft — not visible to teachers and students"}
              </span>
              {status?.published_at && status.has_unpublished_changes && (
                <span className="badge text-bg-warning">Unpublished changes</span>
              )}
              {error && <p role="alert" className="text-danger">{error}</p>}
            </div>
            <div className="generation-confirm-actions">
              <button type="button" className="btn btn-light" onClick={() => setInfoOpen(false)}>
                Close
              </button>
            </div>
          </section>
        </div>
      )}
      {confirmOpen && (
        <div className="generation-confirm-backdrop" role="presentation">
          <section className="generation-confirm-dialog" role="dialog" aria-modal="true"
            aria-labelledby="publication-confirm-title">
            <h2 id="publication-confirm-title" className="h5">Publish timetable?</h2>
            <p>
              Publish the current draft for <strong>{degreeName}</strong>? This replaces the
              previously published timetable for this degree. Teachers and students will
              see the new version immediately.
            </p>
            <div className="generation-confirm-actions">
              <button type="button" className="btn btn-light" autoFocus
                disabled={publishing} onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-campus"
                disabled={publishing} onClick={publish}>
                {publishing ? "Publishing…" : "Confirm publication"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
