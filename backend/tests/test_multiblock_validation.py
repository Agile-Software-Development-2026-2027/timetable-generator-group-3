"""KAN-52: the independent validator checks every block of multi-block sessions."""
from datetime import time
from types import SimpleNamespace as NS

import pytest

from app.engine.engine import Assignment, Solution
from app.engine.facts import Problem
from app.engine.validation import InvalidScheduleError, validate_solution


def make_problem(courses, slots=4, busy_rooms=(), buffer_slots=0, rooms=None):
    """One day of 1-hour slots from 09:00; courses are (id, sessions, blocks)."""
    course_objects = [
        NS(id=i, weekly_hours=n * b, semester_id=1, enrolled_students=20,
           requires_lab=False, requires_projector=False, teachers=[])
        for i, n, b in courses
    ]
    return Problem(
        courses=course_objects,
        rooms=rooms or [NS(id=1, capacity=40, is_lab=False, has_projector=False)],
        slots={(0, s): (time(9 + s), time(10 + s)) for s in range(slots)},
        facts="",
        group_capacity={1: slots},
        buffer_slots=buffer_slots,
        busy_rooms=set(busy_rooms),
        session_blocks={i: b for i, _, b in courses},
        sessions_per_week={i: n for i, n, _ in courses},
    )


def test_valid_two_block_session_passes():
    problem = make_problem([(1, 1, 2)])
    validate_solution(problem, Solution([Assignment(1, 1, 0, 1)], {1}))


def test_session_running_past_the_end_of_the_day_is_rejected():
    problem = make_problem([(1, 1, 2)])
    with pytest.raises(InvalidScheduleError, match="does not exist"):
        validate_solution(problem, Solution([Assignment(1, 1, 0, 3)], {1}))


def test_session_across_a_gap_in_the_grid_is_rejected():
    problem = make_problem([(1, 1, 2)])
    problem.slots[(0, 2)] = (time(12), time(13))  # 11:00-12:00 is not in the grid
    with pytest.raises(InvalidScheduleError, match="gap"):
        validate_solution(problem, Solution([Assignment(1, 1, 0, 1)], {1}))


def test_overlapping_sessions_of_same_course_are_rejected():
    problem = make_problem([(1, 2, 2)])
    with pytest.raises(InvalidScheduleError, match="two sessions in one slot"):
        validate_solution(problem, Solution(
            [Assignment(1, 1, 0, 0), Assignment(1, 1, 0, 1)], {1}
        ))


def test_room_clash_on_second_block_is_rejected():
    problem = make_problem([(1, 1, 2), (2, 1, 1)])
    with pytest.raises(InvalidScheduleError, match="Room 1"):
        validate_solution(problem, Solution(
            [Assignment(1, 1, 0, 0), Assignment(2, 1, 0, 1)], {1, 2}
        ))


def test_busy_reservation_on_second_block_is_rejected():
    problem = make_problem([(1, 1, 2)], busy_rooms={(1, 0, 1)})
    with pytest.raises(InvalidScheduleError, match="Room 1"):
        validate_solution(problem, Solution([Assignment(1, 1, 0, 0)], {1}))


def test_room_transition_buffer_is_measured_from_the_last_block():
    rooms = [NS(id=1, capacity=40, is_lab=False, has_projector=False),
             NS(id=2, capacity=40, is_lab=False, has_projector=False)]
    problem = make_problem([(1, 1, 2), (2, 1, 1)], slots=5, buffer_slots=1, rooms=rooms)

    # Course 1 covers slots 0-1; course 2 starts right after in another room.
    with pytest.raises(InvalidScheduleError, match="room-transition buffer"):
        validate_solution(problem, Solution(
            [Assignment(1, 1, 0, 0), Assignment(2, 2, 0, 2)], {1, 2}
        ))
    # One free slot after the session is enough.
    validate_solution(problem, Solution(
        [Assignment(1, 1, 0, 0), Assignment(2, 2, 0, 3)], {1, 2}
    ))


def test_number_of_sessions_not_hours_is_checked():
    problem = make_problem([(1, 2, 2)])  # 2 sessions of 2 blocks = 4 hours
    validate_solution(problem, Solution(
        [Assignment(1, 1, 0, 0), Assignment(1, 1, 0, 2)], {1}
    ))
    with pytest.raises(InvalidScheduleError, match="expected 2 sessions, got 1"):
        validate_solution(problem, Solution([Assignment(1, 1, 0, 0)], {1}))
