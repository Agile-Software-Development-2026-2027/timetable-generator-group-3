# Automatic Timetable Generation (KAN-15)

Generates a weekly timetable for a degree programme using **Clingo (ASP)**. The engine reads existing courses, teachers, rooms and the configured time slots from the database, then saves the result in `schedule_session`.

## How it works

1. `timetable_generate.py` receives the request and coordinates generation.
2. `engine/facts.py` reads database records and builds ASP facts, including existing reservations outside the selected scope.
3. `engine/engine.py` runs Clingo with the constraints in `engine/model.lp`.
4. `engine/validation.py` checks the proposed timetable before it is saved.
5. The endpoint replaces sessions for the selected courses in one database transaction. Other courses' sessions are preserved.

The solver enforces weekly hours, room and teacher availability, student-group clashes, room capacity, and required lab/projector equipment. If a full timetable is not possible, it can return a partial schedule of complete courses.

## Run

From the `backend/` directory, with the virtual environment activated and the database configured:

```powershell
python -m uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000/docs` and execute **POST `/timetable/generate`** with:

```json
{
  "degree_id": 4,
  "semester_id": null
}
```

`degree_id` is required; `semester_id` is optional. The response includes `status` (`ok`, `partial`, or `infeasible`), `sessions_created`, and `unscheduled`.

**Note:** Generation writes to the configured database and replaces the timetable for the selected scope.

## Tests

From `backend/`:

```powershell
python -m pytest tests/test_engine.py tests/test_generation.py tests/test_generation_validation.py -q
python -m pytest -q
python -m ruff check app/engine app/timetable_generate.py tests/test_generation_validation.py
```

The automated tests use isolated test databases. For the initial AI & CS integration test, the endpoint generated and saved **71 sessions across 14 courses** in **3.672 seconds**, with no detected constraint violations.

For full acceptance criteria and scope, see **KAN-15 in Jira**.
