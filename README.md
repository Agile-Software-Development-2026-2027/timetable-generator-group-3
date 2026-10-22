# University of Calabria Timetable Generator

An automated timetable generator for the University of Calabria. It will use
degree programmes, courses, rooms, teachers, and constraints to produce an
optimized weekly schedule.

The backend lives in [`backend/`](backend/README.md) (FastAPI + SQLAlchemy +
Alembic). See its README for setup, running the migrations, and tests.
The Next.js academic planning UI lives in [`frontend/`](frontend/). Start it
with `npm install` and `npm run dev` from that directory after starting the API.

## How we work

- `main` is protected: nobody can push to it, every change goes through a pull request.
- Branches are short-lived (less than a day) and pull requests are small (less than 200 lines).
- A pull request needs the approval of a teammate and a green CI, and must be up to date with
  `main`. It is merged with a squash merge.
- The backlog and the sprints are on the Jira board of the team, not in this repository.
- The title of a pull request starts with the key of the Jira issue it implements:
  `ABC-12 Add the login form`.
- If `main` is red, fixing it comes before anything else.

## CI

`.github/workflows/ci.yml` runs on every pull request. It starts empty and always passes: add
the steps that build and test the project as soon as there is something to test.
