"""KAN-52: explanations for courses whose multi-block sessions cannot be placed."""
from datetime import time
from types import SimpleNamespace as NS

from app.engine.engine import Assignment, Solution
from app.engine.facts import Problem
from app.engine.reasons import unscheduled_course_reason


def make_course(course_id, sessions=1, blocks=2):
    return NS(id=course_id, name=f"Course {course_id}", semester_id=1,
              weekly_hours=sessions * blocks, enrolled_students=20,
              requires_lab=False, requires_projector=False, teachers=[])


def make_problem(courses, slots=4, rooms=1, buffer_slots=0, busy_rooms=()):
    """One day of 1-hour slots from 09:00; each course is (course, sessions, blocks)."""
    return Problem(
        courses=[c for c, _, _ in courses],
        rooms=[NS(id=r, code=f"R{r}", capacity=100, is_lab=False, has_projector=False)
               for r in range(1, rooms + 1)],
        slots={(0, s): (time(9 + s), time(10 + s)) for s in range(slots)},
        facts="",
        group_capacity={1: slots},
        buffer_slots=buffer_slots,
        busy_rooms=set(busy_rooms),
        session_blocks={c.id: b for c, _, b in courses},
        sessions_per_week={c.id: n for c, n, _ in courses},
    )


def test_session_longer_than_the_day_is_explained():
    course = make_course(1, blocks=5)
    problem = make_problem([(course, 1, 5)], slots=4)

    assert unscheduled_course_reason(problem, course, None) == (
        "Session length: A session of 5 consecutive slots does not fit in one day of the grid."
    )


def test_free_slots_that_are_not_consecutive_are_explained():
    # Slots 0 and 2 are free but never next to each other: no 2-slot period.
    course = make_course(1, blocks=2)
    problem = make_problem([(course, 1, 2)], slots=4, busy_rooms={(1, 0, 1), (1, 0, 3)})

    assert unscheduled_course_reason(problem, course, Solution([], set())) == (
        "Session length: Not enough free periods of 2 consecutive slots for "
        "1 sessions of Course 1."
    )


def test_other_sessions_block_every_slot_they_cover():
    # Course 2 covers slots 1-2, leaving 0, 3 and 4 free: no 3-slot period.
    # If only its start slot counted, slots 2-4 would look free.
    target = make_course(1, blocks=3)
    other = make_course(2, blocks=2)
    problem = make_problem([(target, 1, 3), (other, 1, 2)], slots=5)
    solution = Solution([Assignment(2, 1, 0, 1)], {2})

    assert unscheduled_course_reason(problem, target, solution) == (
        "Session length: Not enough free periods of 3 consecutive slots for "
        "1 sessions of Course 1."
    )


def test_room_transition_is_explained_for_multi_block_sessions():
    # Course 2 covers slots 0-1 in room 1, course 3 covers slots 4-5 in room 2,
    # and both rooms are busy elsewhere. The 2-slot course 1 could only go in
    # slots 2-3 of a different room, which leaves no travel slot on either side.
    target = make_course(1, blocks=2)
    first = make_course(2, blocks=2)
    last = make_course(3, blocks=2)
    problem = make_problem(
        [(target, 1, 2), (first, 1, 2), (last, 1, 2)],
        slots=6, rooms=2, buffer_slots=1,
        busy_rooms={(1, 0, 2), (1, 0, 3)},
    )
    solution = Solution([Assignment(2, 1, 0, 0), Assignment(3, 2, 0, 4)], {2, 3})

    assert unscheduled_course_reason(problem, target, solution) == (
        "Room transition: no slot leaves 15 minutes to change rooms."
    )
