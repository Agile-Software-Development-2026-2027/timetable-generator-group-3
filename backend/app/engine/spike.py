"""KAN-35 — Clingo spike: minimal timetable with 2 courses and 2 rooms.

Problem:
    - 2 courses: Algorithms (2 h/week), Databases (3 h/week)
    - 2 rooms:   MT1 (capacity 110), MT2 (capacity 48)
    - Grid:      Mon–Fri, 09:00–12:00, 60-minute blocks  →  3 slots × 5 days = 15 slots

Expected output:
    A set of assign(course, room, day, slot) atoms with no overlaps.
    Algorithms gets 2 assignments, Databases gets 3.

Run:
    python -m app.engine.spike          (from backend/)
    python backend/app/engine/spike.py  (from repo root)
"""

from __future__ import annotations

import textwrap
import clingo

# ── 1. Problem data ────────────────────────────────────────────────────────────

COURSES = [
    {"id": "algorithms",  "hours": 2},
    {"id": "databases",   "hours": 3},
]

ROOMS = [
    {"id": "MT1", "capacity": 110},
    {"id": "MT2", "capacity": 48},
]

DAYS  = ["mon", "tue", "wed", "thu", "fri"]
SLOTS = [0, 1, 2]   # 09:00–10:00, 10:00–11:00, 11:00–12:00

SLOT_LABELS = {0: "09:00-10:00", 1: "10:00-11:00", 2: "11:00-12:00"}

# ── 2. Build the ASP facts from the data above ─────────────────────────────────

def build_facts() -> str:
    lines: list[str] = ["% --- facts generated from Python data ---"]

    for course in COURSES:
        lines.append(f'course("{course["id"]}", {course["hours"]}).')

    for room in ROOMS:
        lines.append(f'room("{room["id"]}", {room["capacity"]}).')

    for day in DAYS:
        for slot in SLOTS:
            lines.append(f'slot("{day}", {slot}).')

    return "\n".join(lines)


# ── 3. The ASP encoding ────────────────────────────────────────────────────────
#
#  Strategy: choice rule generates all possible assignments;
#  constraints rule out invalid ones; #minimize is not needed here
#  because the problem is purely feasibility at this stage.
#
#  Atoms:
#    assign(Course, Room, Day, Slot)  — place course C in room R at (D,S)
#
#  Rules:
#    (a) Each course must be placed exactly `hours` times across the week.
#    (b) No two courses share the same room at the same (day, slot).
#    (c) No course appears more than once at the same (day, slot)
#        — prevents placing the same course twice in different rooms at the
#        same time, which would be meaningless in a real timetable.

ASP_ENCODING = textwrap.dedent("""\
    % --- encoding ---

    % (a) Generate: for each course, pick exactly `hours` (room, day, slot) combos.
    { assign(C, R, D, S) : room(R, _), slot(D, S) } = H :-
        course(C, H).

    % (b) Constraint: a room cannot host two different courses at the same time.
    :- assign(C1, R, D, S), assign(C2, R, D, S), C1 != C2.

    % (c) Constraint: the same course cannot appear twice at the same time
    %     (regardless of room — a course is one group of students).
    :- assign(C, R1, D, S), assign(C, R2, D, S), R1 != R2.

    #show assign/4.
""")


# ── 4. Solve and print results ─────────────────────────────────────────────────

def solve() -> None:
    program = build_facts() + "\n\n" + ASP_ENCODING

    ctl = clingo.Control(["--models=1"])   # find the first answer set
    ctl.add("base", [], program)
    ctl.ground([("base", [])])

    result: list[clingo.Symbol] = []
    satisfiable = False

    with ctl.solve(yield_=True) as handle:
        for model in handle:
            satisfiable = True
            result = sorted(model.symbols(shown=True), key=str)

    if not satisfiable:
        print("UNSATISFIABLE — no valid timetable exists for this input.")
        return

    print("SATISFIABLE — found a valid assignment:\n")
    print(f"  {'Course':<14} {'Room':<6} {'Day':<5}  Slot")
    print("  " + "-" * 42)

    for atom in result:
        course, room, day, slot = (str(a).strip('"') for a in atom.arguments)
        time = SLOT_LABELS[int(slot)]
        print(f"  {course:<14} {room:<6} {day:<5}  {time}")

    print(f"\nTotal assignments: {len(result)}")
    expected = sum(c["hours"] for c in COURSES)
    assert len(result) == expected, (
        f"Expected {expected} assignments but got {len(result)}"
    )
    print(f"Expected assignments: {expected}  ✓")


if __name__ == "__main__":
    solve()
