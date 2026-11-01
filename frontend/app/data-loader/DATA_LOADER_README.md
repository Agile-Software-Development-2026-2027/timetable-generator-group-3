# Data Loader — KAN-11

The **Data Loader** is a dedicated page in the Timetable Generator for loading and reviewing sample academic data. It supports the KAN-11 user story: *As a timetable administrator, I want to manually enter a sample dataset so that I can test the system end to end.*

The feature uses the existing FastAPI/SQLAlchemy backend and PostgreSQL database. It does not replace the Degree Programmes or Rooms CRUD pages.

## Features

- Upload a JSON dataset containing a degree, academic years and semesters, courses, teachers, and rooms.
- Validate the dataset before import, including required attributes, unique identifiers, relationships, and positive numeric values.
- Preview the degree name and numbers of years, semesters, courses, teachers, and rooms.
- Compare existing shared-room attributes with the submitted file. Any differences require explicit approval to **reuse the database's room values without overwriting them**.
- Confirm the database import before committing it.
- Reuse matching existing records to avoid duplicates; reject conflicting data and roll back the failed transaction.
- Browse **database-backed** Courses, Teachers, Rooms, and Years & Semesters lists, with programme filtering, search, and table pagination (5, 10, 20, or 50 rows per page).

> The record lists show the current database contents, including records that may have existed before an import. They are not an import-history or provenance log.

## Project files

```text
frontend/app/
  data-loader/
    page.jsx
    data-loader.css
    components/
      SeedImporter.jsx
backend/app/
  seed_api.py
  seed/
    seed_sample_data.py
    data/
      *.json
```

## Run locally

### Backend

From the project root (PowerShell):

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --port 8000
```

Ensure your backend's existing database configuration points to the intended development database. The application must already register the `seed_api` router in `app/main.py`. Do **not** commit `.env` files or credentials.

### Frontend

Open another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000/data-loader**. By default, the frontend calls **http://localhost:8000**, unless `NEXT_PUBLIC_API_URL` is configured.

## Import a dataset

1. Go to **Data Loader** and select **Import Data**.
2. Browse and select a `.json` dataset (maximum **256 KB**).
3. Click **Validate**. Review the structure summary and any shared-room differences.
4. If shared rooms differ, decide whether to check **Reuse existing database room properties without overwriting them**. If the actual database room attributes are unsuitable, the import may still fail validation.
5. Click **Import dataset**, review the confirmation dialog, and confirm.
6. Check the success notification, then inspect the database-backed record lists. Importing a valid file again should not create duplicates.

The importer supports a full room definition such as:

```json
{
  "code": "LAB-EXAMPLE",
  "capacity": 35,
  "has_projector": false,
  "has_computers": true,
  "is_lab": true
}
```

A code-only room entry, for example `{"code": "MT10"}`, can refer to an already-existing room. A code-only entry cannot create a missing room. When course data specifies `requires_lab: true`, the backend checks the actual database inventory for a sufficiently large, computer-equipped laboratory.

## View imported academic records

Use **Academic records** on the Data Loader page:

- **Degree programme:** choose a programme, or view all programmes.
- **Courses:** see course, programme, year, semester, weekly hours, enrolment, lab requirement, and assigned teachers.
- **Teachers:** review identifiers and course assignments.
- **Rooms:** inspect code, capacity and facilities. Rooms are shared resources, so the Rooms tab shows the global inventory rather than rooms owned by a particular programme.
- **Years & semesters:** inspect each programme's academic structure.

Use **Search records**, **Rows per page**, **Previous/Next**, and **Refresh** to navigate the lists. The page refreshes records after a successful import.

## Backend endpoints

| Endpoint | Purpose |
|---|---|
| `POST /seed/validate` | Validate a JSON dataset and preview shared-room differences without importing. |
| `POST /seed/import` | Import validated JSON, using a database transaction. |
| `POST /seed/import?reuse_existing_rooms=true` | Explicitly approve reuse of existing room values when there are differences. |
| `GET /seed/records` | Read current degree, course, teacher, room, year and semester records. |
| `GET /seed/records?degree_id=<id>` | Filter programme-related records by degree ID; rooms remain global. |

A failed import is rolled back; existing room values are never automatically overwritten by the loader.

## Optional command-line seed

From `backend/`:

```powershell
python -m app.seed.seed_sample_data --file app/seed/data/ai_cs.json
# Or load every JSON file in the seed data directory:
python -m app.seed.seed_sample_data --all
```

**Important:** The CLI loader uses strict conflict handling and may reject existing room values that differ from a file. The UI provides the explicit shared-room reuse confirmation. Only run `--all` when you intend to load every JSON file in that directory into the configured database.

## KAN-11 acceptance-criteria checks

1. Load a sample with a degree, years/semesters, several courses and teachers, and rooms (including a computer lab and different capacities).
2. Verify that the record lists show the persisted data from PostgreSQL.
3. Import the same dataset again and verify that record counts do not increase unexpectedly.
4. Try an invalid dataset and confirm validation prevents the import.
5. Try a conflicting room definition and verify the difference is displayed and no room is silently overwritten.
6. Confirm the run and import steps are documented here.
