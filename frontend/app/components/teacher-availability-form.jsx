"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api.js";

const DAY_NAMES = [
  "Monday", "Tuesday", "Wednesday", "Thursday",
  "Friday", "Saturday", "Sunday",
];

export default function TeacherAvailabilityForm({ teacherId }) {
  const [entries, setEntries] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [attempt, setAttempt] = useState(0);

  const endpoint = `/teachers/${teacherId}/availability`;

  useEffect(() => {
    let active = true;

    Promise.all([
      apiRequest(endpoint),
      apiRequest("/slot-config"),
    ]).then(([availability, slotConfig]) => {
      if (!active) return;

      if (!Array.isArray(availability)
        || !Array.isArray(slotConfig?.working_days)
        || !slotConfig.working_days.length) {
        throw new Error("Invalid availability configuration.");
      }

      setEntries(availability);
      setConfig(slotConfig);
      setLoading(false);
    }).catch((failure) => {
      if (!active) return;
      setError(failure.message);
      setLoading(false);
    });

    return () => { active = false; };
  }, [endpoint, attempt]);

  function updateEntry(index, field, value) {
    setSuccess("");

    setEntries((current) => current.map(
      (entry, i) => i === index
        ? { ...entry, [field]: value }
        : entry
    ));
  }

  function addEntry() {
    setSuccess("");

    setEntries((current) => [
      ...current,
      {
        weekday: config.working_days[0],
        start_time: config.start_time,
        end_time: config.end_time,
        availability_type: "unavailable",
      },
    ]);
  }

  function removeEntry(index) {
    setSuccess("");
    setEntries((current) => current.filter((_, i) => i !== index));
  }

  function retry() {
    setLoading(true);
    setError("");
    setAttempt((value) => value + 1);
  }

  async function save(event) {
    event.preventDefault();

    if (saving || loading || !config) return;

    setError("");
    setSuccess("");

    if (entries.some((entry) => entry.start_time >= entry.end_time)) {
      setError("End time must be after start time.");
      return;
    }

    setSaving(true);

    try {
      const result = await apiRequest(endpoint, {
        method: "PUT",
        body: JSON.stringify(entries.map((entry) => ({
          weekday: Number(entry.weekday),
          start_time: entry.start_time,
          end_time: entry.end_time,
          availability_type: entry.availability_type,
        }))),
      });

      setEntries(result);
      setSuccess("Teacher availability saved.");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="slot-card mb-3">
      <div className="slot-section">
        <h2 className="slot-section-title">Teacher availability</h2>
        <p className="text-secondary small">
          Configure unavailable and preferred teaching periods.
        </p>

        {loading && (
          <p role="status">Loading availability...</p>
        )}

        {error && (
          <p className="text-danger small" role="alert">{error}</p>
        )}

        {success && (
          <p className="text-success small" role="status">{success}</p>
        )}

        {!loading && !config && (
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={retry}
          >
            Retry
          </button>
        )}
      </div>

      {!loading && config && (
        <form onSubmit={save}>
          <div className="slot-section">
            {entries.length === 0 && (
              <p className="text-secondary small">
                No availability restrictions configured.
              </p>
            )}

            {entries.map((entry, index) => (
              <fieldset
                key={index}
                className="border rounded p-3 mb-3"
                disabled={saving}
              >
                <legend className="h6">
                  Teaching period {index + 1}
                </legend>

                <div className="row g-2 align-items-end">
                  <div className="col-md-3">
                    <label className="form-label">
                      Day
                      <select
                        className="form-select"
                        value={entry.weekday}
                        onChange={(event) => updateEntry(
                          index, "weekday", Number(event.target.value)
                        )}
                      >
                        {[...new Set([
                          ...config.working_days, entry.weekday,
                        ])].map((day) => (
                          <option key={day} value={day}>
                            {DAY_NAMES[day]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {["start_time", "end_time"].map((field) => (
                    <div className="col-md-2" key={field}>
                      <label className="form-label">
                        {field === "start_time" ? "Start" : "End"}
                        <input
                          type="time"
                          className="form-control"
                          value={entry[field]}
                          min={config.start_time}
                          max={config.end_time}
                          step="1"
                          required
                          onChange={(event) => updateEntry(
                            index, field, event.target.value
                          )}
                        />
                      </label>
                    </div>
                  ))}

                  <div className="col-md-3">
                    <label className="form-label">
                      Availability
                      <select
                        className="form-select"
                        value={entry.availability_type}
                        onChange={(event) => updateEntry(
                          index, "availability_type", event.target.value
                        )}
                      >
                        <option value="unavailable">Unavailable</option>
                        <option value="preferred">Preferred</option>
                      </select>
                    </label>
                  </div>

                  <div className="col-md-2">
                    <button
                      type="button"
                      className="btn btn-outline-danger mb-2"
                      onClick={() => removeEntry(index)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </fieldset>
            ))}

            <button
              type="button"
              className="btn btn-outline-secondary"
              disabled={saving}
              onClick={addEntry}
            >
              Add period
            </button>
          </div>

          <div className="slot-actions">
            <button
              type="submit"
              className="btn btn-campus"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save availability"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
