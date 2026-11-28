# Timetable Engine — ASP Encoding Guide (KAN-35)

This document explains the Answer Set Programming (ASP) strategy agreed by the
team for the scheduling engine. Read it before starting KAN-15.

---

## Why ASP / Clingo

The timetable problem is a **Constraint Satisfaction Problem** (CSP): given a
set of courses, rooms and time slots, find an assignment that satisfies all
hard rules. ASP solvers like Clingo handle CSPs declaratively — you describe
*what* is forbidden, not *how* to search. This makes the constraints easy to
read, test and extend without touching the search algorithm.

---

## Key concepts

### Atoms

The building blocks of the model are **ground atoms** (facts about the world):

| Atom | Meaning |
|------|---------|
| `course("algorithms", 2)` | Course *algorithms* needs 2 weekly hours |
| `room("MT1", 110)` | Room *MT1* has capacity 110 |
| `slot("mon", 0)` | Slot 0 on Monday (09:00–10:00) |
| `assign("algorithms", "MT1", "mon", 0)` | *algorithms* is placed in MT1 at Mon 09:00 |

Facts come from the database at runtime. The solver chooses which `assign`
atoms to include in the answer set.

### Rules

```lp
% Choice rule: for each course C with H weekly hours,
% pick exactly H (room, day, slot) combinations.
{ assign(C, R, D, S) : room(R, _), slot(D, S) } = H :-
    course(C, H).
```

This is the **generator** — it tells Clingo to enumerate all possible
ways to assign a course to H slots. The constraints below prune the invalid
ones.

### Hard constraints (integrity constraints)

Constraints start with `:-` and mean *"this situation must never occur"*.

```lp
% A room cannot host two different courses at the same (day, slot).
:- assign(C1, R, D, S), assign(C2, R, D, S), C1 != C2.

% The same course cannot appear twice at the same (day, slot).
:- assign(C, R1, D, S), assign(C, R2, D, S), R1 != R2.
```

For the full engine (KAN-15 / KAN-16) add these additional constraints:

```lp
% Teacher cannot teach two courses at the same (day, slot).
:- assign(C1, _, D, S), assign(C2, _, D, S),
   teaches(T, C1), teaches(T, C2), C1 != C2.

% Student group clash: courses in the same degree/year/semester
% cannot overlap.
:- assign(C1, _, D, S), assign(C2, _, D, S), C1 != C2,
   same_group(C1, C2).

% Room capacity must cover enrolled students.
:- assign(C, R, _, _),
   course_students(C, N), room(R, Cap), Cap < N.

% Lab requirement.
:- assign(C, R, _, _), requires_lab(C), not is_lab(R).

% Projector requirement.
:- assign(C, R, _, _), requires_projector(C), not has_projector(R).
```

### Soft constraints / optimisation (KAN-41)

Soft constraints use `#minimize` with a cost and a priority level:

```lp
% Penalise gaps within a student group's day (lower priority = nice-to-have).
gap(C1, C2, D) :-
    assign(C1, _, D, S1), assign(C2, _, D, S2),
    same_group(C1, C2), S2 > S1 + 1.
#minimize { 1, C1, C2, D : gap(C1, C2, D) }.
```

Priority levels in `model.lp` (a higher level always wins over a lower one):

| Level | Rule | Story |
|-------|------|-------|
| @4 | Maximise scheduled hours (partial mode only) | KAN-15 |
| @3 | Spread a course's sessions over different days | KAN-55 |
| @2 | Use the slots teachers marked as preferred | KAN-57 |
| @1 | Use the smallest room that fits the group | KAN-16 |

Scheduled hours stay at the top, so no preference ever makes the partial
solver drop a course. New soft constraints (compact days KAN-41, edge slots
KAN-56, same room KAN-64) should fit into this ladder without going above @4.

KAN-55 counts every extra session of a course on the same day, so a day with
k sessions costs k-1:

```lp
starts(C,D,S) :- assign(C,_,D,S).
same_day(C,D,S2) :- starts(C,D,S1), starts(C,D,S2), S1 < S2.
#minimize { 1@3,C,D,S : same_day(C,D,S) }.
```

`starts/3` drops the room before pairing the sessions. Pairing `assign/4`
directly grounds every room and slot combination and made the solver noticeably
slower on the real data.

---

## How to run the spike

```bash
cd backend
python -m app.engine.spike
```

Expected output:

```
SATISFIABLE — found a valid assignment:

  Course         Room   Day    Slot
  ------------------------------------------
  algorithms     MT2    mon    11:00-12:00
  algorithms     MT2    tue    11:00-12:00
  databases      MT1    mon    09:00-10:00
  databases      MT1    mon    11:00-12:00
  databases      MT2    mon    10:00-11:00

Total assignments: 5
Expected assignments: 5  ✓
```

---

## How the full engine will work (KAN-15)

```
Database → Python → ASP facts string → Clingo.solve() → parse atoms → save schedule_session rows
```

1. **Python reads** courses, rooms, teachers, `slot_config` from the DB.
2. **Python builds** a string of ASP facts (same pattern as `spike.py::build_facts()`).
3. **Python loads** `app/engine/model.lp` (the rules and constraints).
4. **Clingo solves**: finds the first answer set satisfying all hard constraints.
5. **Python parses** the `assign/4` atoms from the answer set.
6. **Python writes** one `schedule_session` row per atom.
7. **Python returns** `{status, sessions_created, unscheduled}` to the FastAPI endpoint.

The `.lp` file contains only rules and constraints (no facts) — facts are
injected at runtime from the database so the model never needs to change when
the data changes.

---

## Files

| File | Purpose |
|------|---------|
| `spike.py` | Working minimal example (KAN-35, this story) |
| `model.lp` | Full ASP model (KAN-15, Sprint 2) — rules + hard constraints |
| `engine.py` | Python wrapper: reads DB, calls Clingo, writes sessions (KAN-15) |
| `README.md` | This file |

---

## Agreed encoding decisions

- Facts use **quoted string identifiers** (`"algorithms"`, `"MT1"`) to avoid
  Clingo atom-name restrictions with spaces or special characters.
- Slots are identified by **(day_string, slot_index)** pairs — the index maps
  directly to `SlotConfig.grid[day][index]`.
- The model targets **one answer set** (`--models=1`). Finding the optimal
  solution (soft constraints) uses `--models=0` with `#minimize`.
- Teacher–session linking is implicit: the `teaches(Teacher, Course)` fact is
  derived from `course_teacher` rows. There is no `teacher_id` on
  `schedule_session` — the teacher is inferred via the course.

---

## Multi-block sessions (KAN-52)

A session can last several consecutive grid blocks (for example a 2-hour
lesson on a 30-minute grid covers 4 blocks). `facts.py` emits, per course:

| Fact | Meaning |
|------|---------|
| `duration(C, B)` | One session of C lasts B consecutive blocks (`session_duration_minutes / block_minutes`, 60 minutes until KAN-51 adds the column) |
| `sessions(C, N)` | C has N sessions per week (`weekly_hours * 60 / session_duration_minutes`) |
| `start_ok(C, D, S)` | A session of C may start at slot S of day D: blocks S..S+B-1 exist on D with no gap between them |

In `model.lp`, `assign(C, R, D, S)` is the **start slot** of a session and
each course gets exactly N of them. The derived atom

```prolog
occupies(C, R, D, S..S+B-1) :- assign(C, R, D, S), duration(C, B).
```

covers every block of a session. All hard constraints (room, group and
teacher clashes, `busy_*` reservations, the KAN-53 travel buffer) are written
on `occupies/4`, so new constraints (availability, workload, soft
preferences) should use `occupies/4` too, not `assign/4`.

`validation.py` and `reasons.py` expand each assignment into its blocks with
`Problem.covered_slots()`, and generation saves one `schedule_session` row per
session with its real start and end time (e.g. 09:00–11:00).
