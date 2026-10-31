"use client";

import { useState, useEffect } from "react";

export default function TeachersPage() {
  const [teachers, setTeachers] = useState([]);
  const [courses, setCourses] = useState([]);
  const [identifier, setIdentifier] = useState("");
  const [fullName, setFullName] = useState("");
  const [selectedCourseIds, setSelectedCourseIds] = useState([]);
  const [editingTeacher, setEditingTeacher] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const API_BASE = "http://127.0.0.1:8000/api";

  const loadData = async () => {
    try {
      const [tRes, cRes] = await Promise.all([
        fetch(`${API_BASE}/teachers/`),
        fetch(`${API_BASE}/degrees/courses`).catch(() => null)
      ]);
      if (tRes.ok) {
        const data = await tRes.json();
        setTeachers(data);
      }
      if (cRes && cRes.ok) {
        const data = await cRes.json();
        setCourses(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const validateForm = () => {
    const trimmedId = identifier.trim();
    const trimmedName = fullName.trim();

    if (!trimmedId) return "Identifier cannot be empty.";
    if (trimmedId.length < 3) return "Identifier must be at least 3 characters long.";
    if (/\s/.test(trimmedId)) return "Identifier cannot contain spaces.";

    const hasAt = trimmedId.includes("@");
    const hasDomainEnding = /\.[a-zA-Z]{2,}$/.test(trimmedId);

    if (hasAt || hasDomainEnding) {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(trimmedId)) {
        return "Invalid email format: an '@' symbol and a valid domain are required (e.g. name@domain.com).";
      }
    } else {
      const staffCodeRegex = /^[a-zA-Z0-9_-]{3,20}$/;
      if (!staffCodeRegex.test(trimmedId)) {
        return "Invalid staff code: use 3-20 letters, numbers, hyphens, or underscores (or enter a valid email with '@').";
      }
    }

    if (!trimmedName) return "Full name cannot be empty.";
    if (trimmedName.length < 2) return "Full name must be at least 2 characters long.";
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    const payload = {
      identifier: identifier.trim(),
      full_name: fullName.trim(),
      course_ids: selectedCourseIds
    };

    try {
      const url = editingTeacher
        ? `${API_BASE}/teachers/${editingTeacher.id}`
        : `${API_BASE}/teachers/`;
      const method = editingTeacher ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json();
        setError(errData.detail || "Operation failed.");
        setLoading(false);
        return;
      }

      setIdentifier("");
      setFullName("");
      setSelectedCourseIds([]);
      setEditingTeacher(null);
      await loadData();
    } catch (err) {
      setError("Unable to connect to the server.");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async (teacher) => {
    setError(null);
    setEditingTeacher(teacher);
    setIdentifier(teacher.identifier);
    setFullName(teacher.full_name);
    try {
      const res = await fetch(`${API_BASE}/teachers/${teacher.id}`);
      if (res.ok) {
        const details = await res.json();
        setSelectedCourseIds(details.courses.map((c) => c.id));
      }
    } catch {
      setSelectedCourseIds([]);
    }
  };

  const handleCancelEdit = () => {
    setEditingTeacher(null);
    setIdentifier("");
    setFullName("");
    setSelectedCourseIds([]);
    setError(null);
  };

  const handleDelete = async (teacher) => {
    setError(null);
    let force = false;
    if (teacher.courses_count > 0) {
      const confirmed = window.confirm(
        `Teacher '${teacher.full_name}' is assigned to ${teacher.courses_count} course(s).\n\nDo you want to automatically remove all course assignments and delete this teacher?`
      );
      if (!confirmed) return;
      force = true;
    } else {
      if (!window.confirm(`Delete teacher '${teacher.full_name}'?`)) return;
    }

    try {
      const res = await fetch(`${API_BASE}/teachers/${teacher.id}?force=${force}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.detail || "Failed to delete teacher.");
        return;
      }
      loadData();
    } catch {
      setError("Unable to connect to the server.");
    }
  };

  return (
    <div style={{ maxWidth: "900px", margin: "2rem auto", padding: "1.5rem", fontFamily: "sans-serif" }}>
      <h2>Teacher Management</h2>

      {error && (
        <div style={{ padding: "0.8rem", background: "#fee2e2", color: "#991b1b", borderRadius: "6px", marginBottom: "1rem" }}>
          ⚠️ {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ background: "#f8fafc", padding: "1.5rem", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "2rem" }}>
        <h3>{editingTeacher ? "Edit Teacher" : "Register New Teacher"}</h3>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <div style={{ flex: "1 1 200px" }}>
            <label style={{ display: "block", marginBottom: "0.3rem", fontSize: "0.85rem", color: "#475569", fontWeight: "bold" }}>
              Staff Code or Email (with @) *
            </label>
            <input
              type="text"
              placeholder="e.g. T101 or prof@unical.it"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              minLength={3}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #ccc", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label style={{ display: "block", marginBottom: "0.3rem", fontSize: "0.85rem", color: "#475569", fontWeight: "bold" }}>
              Full Name (min. 2 chars) *
            </label>
            <input
              type="text"
              placeholder="e.g. Prof. Alan Turing"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              minLength={2}
              style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #ccc", boxSizing: "border-box" }}
            />
          </div>
        </div>

        {courses.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "bold" }}>Assign to Courses:</label>
            <div style={{ maxHeight: "120px", overflowY: "auto", border: "1px solid #ccc", padding: "0.5rem", borderRadius: "4px" }}>
              {courses.map((c) => (
                <label key={c.id} style={{ display: "block", margin: "0.2rem 0" }}>
                  <input
                    type="checkbox"
                    checked={selectedCourseIds.includes(c.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedCourseIds([...selectedCourseIds, c.id]);
                      else setSelectedCourseIds(selectedCourseIds.filter((id) => id !== c.id));
                    }}
                  />{" "}
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="submit" disabled={loading} style={{ padding: "0.6rem 1.2rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}>
            {editingTeacher ? "Update Teacher" : "Save Teacher"}
          </button>
          {editingTeacher && (
            <button type="button" onClick={handleCancelEdit} style={{ padding: "0.6rem 1.2rem", background: "#94a3b8", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
        <thead>
          <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #cbd5e1" }}>
            <th style={{ padding: "0.75rem" }}>Identifier</th>
            <th style={{ padding: "0.75rem" }}>Full Name</th>
            <th style={{ padding: "0.75rem" }}>Assigned Courses</th>
            <th style={{ padding: "0.75rem" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {teachers.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ padding: "1rem", textAlign: "center", color: "#64748b" }}>No teachers registered yet.</td>
            </tr>
          ) : (
            teachers.map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                <td style={{ padding: "0.75rem" }}>{t.identifier}</td>
                <td style={{ padding: "0.75rem" }}>{t.full_name}</td>
                <td style={{ padding: "0.75rem" }}>{t.courses_count}</td>
                <td style={{ padding: "0.75rem", display: "flex", gap: "0.5rem" }}>
                  <button onClick={() => handleEdit(t)} style={{ padding: "0.3rem 0.6rem", background: "#f59e0b", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}>
                    Edit
                  </button>
                  <button onClick={() => handleDelete(t)} style={{ padding: "0.3rem 0.6rem", background: "#ef4444", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer" }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
