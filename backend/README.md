# Timetable Generator — Backend

FastAPI + SQLAlchemy backend for the University of Calabria timetable generator.
This package delivers the relational data model and the database plumbing the
rest of the system builds on.

## Database

The database is hosted on **Supabase (PostgreSQL)** and is shared by the whole
team. The schema is owned and applied by the project maintainer directly in
Supabase. The rest of the team connects to the same database to write queries
and CRUD endpoints — there is nothing to recreate locally.

The exact shape of the schema is versioned in [`schema.sql`](schema.sql) so
everyone can see the tables, columns, and constraints when writing queries. It
is generated from the SQLAlchemy models in `app/models.py`, which remain the
source of truth.

## Data model

Six entities and one association table (see `app/models.py`):

| Entity   | Key fields                                                                 |
|----------|----------------------------------------------------------------------------|
| Degree   | `name` (unique, non-empty)                                                 |
| Year     | `number` (unique per degree) → belongs to a Degree                         |
| Semester | `number` (unique per year) → belongs to a Year                             |
| Course   | `name`, `weekly_hours` (>0), `enrolled_students` (>0), `requires_lab`      |
| Teacher  | `name`, `identifier` (unique)                                              |
| Room     | `code` (unique), `capacity` (>0), `has_projector`, `has_computers`, `is_lab` |

Relationships / cardinalities:

- A **Degree** has many **Years**; a **Year** has many **Semesters** (typically two).
- A **Course** belongs to exactly one Degree, one Year, and one Semester.
- A **Course** can have one or more **Teachers**, and a **Teacher** can teach
  many **Courses** (many-to-many via `course_teacher`).
- **Room** is an independent resource used by the scheduling engine later.

Integrity is enforced with primary keys, foreign keys, unique constraints, and
check constraints (positive capacities/hours, non-empty names). Boolean feature
flags default to `false`.

## Requirements

- Python 3.11+
- Access to the shared Supabase database (connection string), or SQLite for a
  quick local run.

## Setup

```bash
cd backend
uv venv                      # or: python3 -m venv .venv
source .venv/bin/activate
uv pip install -e .          # or: pip install -e .
cp .env.example .env         # then set DATABASE_URL
```

`DATABASE_URL` is the only required setting and is read from the environment
(or `.env`). Nothing is hardcoded. Examples:

```bash
# Shared Supabase database (connection pooler, session mode).
# The full string — including the password — is NOT in this repo.
# Ask the project maintainer for it; it is shared privately.
DATABASE_URL=postgresql+psycopg2://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
# SQLite (quick local run)
DATABASE_URL=sqlite:///./timetable.db
```

SSL is requested automatically for Supabase hosts, so you don't need to add
`sslmode` to the URL.

> The connection string contains the database password, so it is never
> committed. `.env` is git-ignored, and `.env.example` only shows placeholders.
> The maintainer shares the real string privately with the team.

## Running the API

```bash
uvicorn app.main:app --reload
# health check:
curl http://127.0.0.1:8000/health   # -> {"status":"ok"}
```

Degree management is available at `/degrees` (list/create), `/degrees/{id}`
(view/update), and `DELETE /degrees/{id}`. Creation accepts `name`, `years`
(1–6), and optional `semesters_per_year` (default 2). The Next.js UI is in
`../frontend`; set `NEXT_PUBLIC_API_URL` if the API is not at localhost:8000.

Room management is available at `/rooms` (list/create), `/rooms/{id}`
(view/update), and `DELETE /rooms/{id}`. A room has a `code` (unique,
case-insensitive), a `capacity` (positive whole number), and the feature flags
`has_projector`, `has_computers`, and `is_lab`. Filter the list by feature with
query parameters, e.g. `GET /rooms?is_lab=true`. Each room reports how many
`scheduled_sessions` use it; deleting a room that the saved timetable uses
returns `409` with a warning, and `DELETE /rooms/{id}?force=true` confirms it
(those sessions are kept without a room). The UI is at `/rooms` in the frontend.

The recurring timetable API is available at `/timetable/sessions` (list/create),
`/timetable/sessions/{id}` (update/delete), `/courses`, and `/rooms`. Sessions
store weekday (Monday=0), start/end times, course, and optional room. Apply the
`schedule_session` table definition from `schema.sql` to Supabase before using
the calendar there. SQLite creates missing tables on startup.

## Manual Data Loader

A reusable JSON-based seed loader provides sample datasets for AI & Computer
Science, Mathematics, and Software Engineering. It validates input and reuses
existing records to avoid duplicates.

Run from `backend/` with the virtual environment activated and database configured:

```bash
# Load all available datasets
python -m app.seed.seed_sample_data --all

# Load one degree program
python -m app.seed.seed_sample_data --file app/seed/data/ai_cs.json
```

For dataset details and instructions for adding another degree, see the
[Data Loader README](app/seed/README.md).
