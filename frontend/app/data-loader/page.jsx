"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import SeedImporter from "./components/SeedImporter";
import "./data-loader.css";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TABS = ["Courses", "Teachers", "Rooms", "Years & semesters"];
const PAGE_SIZES = [5, 10, 20, 50];

export default function DataLoaderPage() {
  const [records, setRecords] = useState(null);
  const [degreeId, setDegreeId] = useState("");
  const [tab, setTab] = useState("Courses");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = degreeId ? `?degree_id=${encodeURIComponent(degreeId)}` : "";
      const response = await fetch(`${API}/seed/records${params}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.detail === "string" ? body.detail : `Unable to load records (${response.status}).`);
      }
      setRecords(await response.json());
    } catch (err) {
      setError(err.message || "Could not load academic records.");
    } finally {
      setLoading(false);
    }
  }, [degreeId]);

  useEffect(() => { refresh(); }, [refresh]);
  const rows = useMemo(() => {
    if (!records) return [];
    const key = tab === "Years & semesters" ? "years" : tab.toLowerCase();
    const all = records[key] || [];
    const needle = search.trim().toLowerCase();
    return needle ? all.filter((record) => JSON.stringify(record).toLowerCase().includes(needle)) : all;
  }, [records, tab, search]);

  // Filter first, then paginate. Clamp the page if the dataset gets smaller.
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const firstRow = rows.length ? (safePage - 1) * pageSize + 1 : 0;
  const lastRow = rows.length ? firstRow + pageRows.length - 1 : 0;

  // Reset pagination when switching datasets, tabs, filters or page size.
  useEffect(() => { setCurrentPage(1); }, [degreeId, tab, search, pageSize]);

  const yesNo = (value) => value ? "Yes" : "No";
  const cells = (row) => {
    switch (tab) {
      case "Courses": return [row.name, row.degree, row.year ?? "—", row.semester ?? "—", row.weekly_hours, row.enrolled_students, yesNo(row.requires_lab), row.teachers.map((t) => t.name).join(", ") || "—"];
      case "Teachers": return [row.name, row.identifier, row.courses.join(", ") || "No assigned courses in this view"];
      case "Rooms": return [row.code, row.capacity, yesNo(row.is_lab), yesNo(row.has_computers), yesNo(row.has_projector)];
      default: return [row.degree, row.number, row.semesters.map((s) => s.number).join(", ") || "—"];
    }
  };
  const headings = {
    Courses: ["Course", "Degree", "Year", "Semester", "Hours / wk", "Students", "Needs lab", "Teachers"],
    Teachers: ["Teacher", "Identifier", "Assigned courses"],
    Rooms: ["Room", "Capacity", "Lab", "Computers", "Projector"],
    "Years & semesters": ["Degree", "Year", "Semesters"],
  };

  return <div className="campus-app">
    <nav className="navbar campus-nav"><div className="container d-flex justify-content-between align-items-center flex-wrap gap-2">
      <Link className="navbar-brand" href="/">UNICAL <span>UNIVERSITY OF CALABRIA</span></Link>
      <div className="nav-actions">
        <Link className="btn btn-outline-light btn-sm" href="/">Degree programmes</Link>
        <Link className="btn btn-outline-light btn-sm" href="/rooms">Rooms</Link>
        <Link className="btn btn-outline-light btn-sm" href="/teachers">Teachers</Link>
        <Link className="btn btn-outline-light btn-sm" href="/calendar">Open timetable</Link>
      </div>
    </div></nav>

    <main className="container py-4 loader-main">
      <header className="mb-4"><p className="eyebrow mb-2">ACADEMIC PLANNING</p>
        <h1 className="display-5 fw-semibold mb-1">Data Loader</h1>
        <p className="text-secondary mb-0">Import validated academic datasets and explore records saved in the database.</p>
      </header>

      <section className="loader-panel mb-4" aria-labelledby="loader-import-title">
        <div><h2 className="h5 mb-2" id="loader-import-title">Import academic data</h2>
          <p className="text-secondary mb-0">Load a complete degree, including years, semesters, courses, teachers and rooms. Existing record checks and confirmation remain enabled.</p>
        </div>
        <SeedImporter onImported={refresh} />
      </section>

      <section className="loader-records" aria-labelledby="loader-records-title">
        <div className="loader-records-header">
          <div><h2 className="h4 mb-1" id="loader-records-title">Academic records</h2>
            <p className="text-secondary small mb-0">Live records from PostgreSQL, not the uploaded JSON preview.</p></div>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={refresh} disabled={loading}>Refresh</button>
        </div>
        <div className="loader-filters">
          <label className="loader-filter-label">Degree programme
            <select className="form-select" value={degreeId} onChange={(event) => setDegreeId(event.target.value)}>
              <option value="">All degree programmes</option>
              {(records?.degrees || []).map((degree) => <option key={degree.id} value={degree.id}>{degree.name}</option>)}
            </select>
          </label>
          <label className="loader-filter-label">Search records
            <input type="search" className="form-control" placeholder="Search current table" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
        </div>
        <div className="loader-tabs" role="tablist" aria-label="Academic record type">
          {TABS.map((name) => <button key={name} type="button" className={`loader-tab ${tab === name ? "is-active" : ""}`}
            role="tab" aria-selected={tab === name} onClick={() => { setTab(name); setSearch(""); }}>{name}</button>)}
        </div>
        {tab === "Rooms" && <p className="loader-room-note">Rooms are shared resources across all degrees, so this tab always shows the global room inventory.</p>}
        {error && <div role="alert" className="alert alert-danger m-3">{error}</div>}
        <div className="loader-table-scroll">
          <table className="table loader-table mb-0">
            <thead><tr>{headings[tab].map((heading) => <th scope="col" key={heading}>{heading}</th>)}</tr></thead>
            <tbody>
              {!loading && !error && pageRows.map((record) => <tr key={record.id}>{cells(record).map((value, i) => <td key={i}>{value}</td>)}</tr>)}
              {(loading || (!error && rows.length === 0)) && <tr><td className="loader-empty" colSpan={headings[tab].length}>
                {loading ? "Loading records…" : "No records found."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="loader-footer loader-pagination" aria-label="Table pagination">
          <label className="loader-page-size">Rows per page
            <select className="form-select form-select-sm" aria-label="Rows per page" value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}>
              {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <span className="loader-page-summary" aria-live="polite">
            {loading ? "Loading…" : error ? "Unable to load records" : `${firstRow}–${lastRow} of ${rows.length} records`}
          </span>
          <div className="loader-page-controls" role="group" aria-label="Navigate table pages">
            <button type="button" className="btn btn-outline-secondary btn-sm"
              disabled={loading || !!error || safePage === 1}
              onClick={() => setCurrentPage(1)} aria-label="First page">«</button>
            <button type="button" className="btn btn-outline-secondary btn-sm"
              disabled={loading || !!error || safePage === 1}
              onClick={() => setCurrentPage(safePage - 1)} aria-label="Previous page">Previous</button>
            <span className="loader-page-number">Page {safePage} of {totalPages}</span>
            <button type="button" className="btn btn-outline-secondary btn-sm"
              disabled={loading || !!error || safePage === totalPages}
              onClick={() => setCurrentPage(safePage + 1)} aria-label="Next page">Next</button>
            <button type="button" className="btn btn-outline-secondary btn-sm"
              disabled={loading || !!error || safePage === totalPages}
              onClick={() => setCurrentPage(totalPages)} aria-label="Last page">»</button>
          </div>
        </div>
      </section>
    </main>
  </div>;
}
