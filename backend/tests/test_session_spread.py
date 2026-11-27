"""KAN-55: spread a course's sessions over different days (soft constraint)."""
from collections import Counter
from types import SimpleNamespace

from app.engine.engine import solve
from app.engine.facts import Problem
from tests.test_engine import make_block_problem


def sessions_per_day(solution, course_id):
    return sorted(
        Counter(a.day for a in solution.assignments if a.course_id == course_id).values(),
        reverse=True,
    )


def test_two_sessions_with_free_days_go_on_different_days():
    problem = make_block_problem("room(1,100). students(1,10). group(1,1).",
                                 [(1, 2, 1)], slots_per_day=3, days=5)

    solution = solve(problem)

    assert sessions_per_day(solution, 1) == [1, 1]


def test_four_sessions_on_three_days_are_scheduled_and_spread():
    """Spreading is impossible, so the course is still scheduled, as 2+1+1."""
    problem = make_block_problem("room(1,100). students(1,10). group(1,1).",
                                 [(1, 4, 1)], slots_per_day=3, days=3)

    solution = solve(problem)

    assert solution.scheduled_ids == {1}
    assert sessions_per_day(solution, 1) == [2, 1, 1]


def test_multi_block_sessions_are_spread():
    """KAN-52: two 2-block sessions use two different days."""
    problem = make_block_problem("room(1,100). students(1,10). group(1,1).",
                                 [(1, 2, 2)], slots_per_day=4, days=2)

    solution = solve(problem)

    assert sessions_per_day(solution, 1) == [1, 1]


def test_spreading_beats_teacher_preferences():
    """@3 spreading sits above @2 teacher preferences (KAN-57)."""
    facts = ("room(1,100). students(1,10). group(1,1). teaches(7,1). "
             "prefers_slot(7,0,0). prefers_slot(7,0,1).")
    problem = make_block_problem(facts, [(1, 2, 1)], slots_per_day=2, days=2)

    solution = solve(problem)

    assert sessions_per_day(solution, 1) == [1, 1]


def test_spreading_never_makes_the_solver_drop_a_course():
    """A one-day grid forces same-day sessions; the courses are still scheduled.

    Courses 1 and 2 need 4 blocks for 3 slots, so the partial model runs and
    schedules course 1 (two sessions on the same day) plus course 3, rather
    than leaving course 1 out to avoid the same-day penalty.
    """
    facts = "\n".join([
        "room(1,100). buffer_slots(0).", *(f"slot(0,{s})." for s in range(3)),
        "course(1,2). sessions(1,2). course(2,2). sessions(2,2). course(3,1). sessions(3,1).",
        *(f"students({c},10). duration({c},1). group({c},1)." for c in (1, 2, 3)),
        *(f"start_ok({c},0,{s})." for c in (1, 2, 3) for s in range(3)),
    ])
    courses = [SimpleNamespace(id=c, semester_id=1, weekly_hours=h)
               for c, h in ((1, 2), (2, 2), (3, 1))]
    problem = Problem(courses=courses, rooms=[1], slots={(0, s): (None, None) for s in range(3)},
                      facts=facts, group_capacity={1: 3})

    solution = solve(problem)

    hours = {1: 2, 2: 2, 3: 1}
    assert sum(hours[c] for c in solution.scheduled_ids) == 3
    assert 3 in solution.scheduled_ids
