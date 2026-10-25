# Data Loader

Reusable seed loader for testing the Timetable Generator with multiple degree programs.

## Datasets

JSON files in `data/` describe academic structures, courses, teachers and rooms.

| Dataset | Courses | Teachers | Rooms referenced |
|---|---:|---:|---:|
| AI & Computer Science | 14 | 17 | 19 |
| Mathematics | 3 | 3 | 3 |
| Software Engineering | 3 | 3 | 3 |

Rooms can be shared across degrees without duplication.

## Usage

From `backend/`, with the virtual environment active and `DATABASE_URL` configured:

```bash
# One degree
python -m app.seed.seed_sample_data --file app/seed/data/ai_cs.json

# All degrees
python -m app.seed.seed_sample_data --all
```

## Add a degree

Create another JSON file under `app/seed/data/` using `ai_cs.json` as a template.
Run `--file` for that dataset or `--all` for every dataset; no Python changes needed.

## Validation and safety

The loader checks dataset fields, links courses to their academic structure and
teachers, reuses matching records, and rejects conflicting existing records.
Imports run in a transaction to avoid partial writes.

**Data note:** AI & CS courses and lecturers are based on the UniCal 2026/27, enrollment counts are synthetic and weekly hours represent an
October 2026 sample. Mathematics and Software Engineering are synthetic examples.

**Warning:** The loader writes to the database configured in `backend/.env`.
Verify the connection before running against the shared database.
