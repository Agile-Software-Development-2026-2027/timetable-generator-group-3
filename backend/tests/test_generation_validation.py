"""Unit tests for the independent KAN-15 solution validator."""
from types import SimpleNamespace as NS
from datetime import time

import pytest

from app.engine.engine import Assignment, Solution
from app.engine.facts import Problem
from app.engine.validation import InvalidScheduleError, validate_solution


def make_problem() -> Problem:
    teachers = [NS(id=10)]
    courses = [
        NS(id=1, weekly_hours=1, semester_id=1, enrolled_students=25,
           requires_lab=True, requires_projector=True, teachers=teachers),
        NS(id=2, weekly_hours=1, semester_id=2, enrolled_students=15,
           requires_lab=False, requires_projector=False, teachers=teachers),
    ]
    rooms = [
        NS(id=1, capacity=30, is_lab=True, has_projector=True),
        NS(id=2, capacity=20, is_lab=False, has_projector=False),
    ]
    return Problem(
        courses=courses, rooms=rooms,
        slots={(0, 0): (time(9), time(10)), (0, 1): (time(10), time(11))},
        facts="", group_capacity={1: 2, 2: 2},
    )


def test_valid_solution_passes():
    problem = make_problem()
    validate_solution(problem, Solution(
        [Assignment(1, 1, 0, 0), Assignment(2, 2, 0, 1)], {1, 2}
    ))


@pytest.mark.parametrize("assignments,expected", [
    ([Assignment(1, 2, 0, 0)], "capacity"),
    ([Assignment(1, 999, 0, 0)], "does not exist"),
    ([Assignment(1, 1, 0, 99)], "does not exist"),
    ([Assignment(1, 1, 0, 0), Assignment(1, 1, 0, 0)], "two sessions"),
])
def test_invalid_assignments_rejected(assignments, expected):
    problem = make_problem()
    with pytest.raises(InvalidScheduleError, match=expected):
        validate_solution(problem, Solution(assignments, {1}))


def test_teacher_clash_rejected_even_across_groups():
    problem = make_problem()
    with pytest.raises(InvalidScheduleError, match="teacher conflict"):
        validate_solution(problem, Solution(
            [Assignment(1, 1, 0, 0), Assignment(2, 2, 0, 0)], {1, 2}
        ))


def test_external_room_reservation_rejected():
    problem = make_problem()
    problem.busy_rooms.add((1, 0, 0))
    with pytest.raises(InvalidScheduleError, match="Room"):
        validate_solution(problem, Solution([Assignment(1, 1, 0, 0)], {1}))


def test_external_group_reservation_rejected():
    problem = make_problem()
    problem.busy_groups.add((1, 0, 0))
    with pytest.raises(InvalidScheduleError, match="Student group"):
        validate_solution(problem, Solution([Assignment(1, 1, 0, 0)], {1}))


def test_external_teacher_reservation_rejected():
    problem = make_problem()
    problem.busy_teachers.add((10, 0, 0))
    with pytest.raises(InvalidScheduleError, match="teacher conflict"):
        validate_solution(problem, Solution([Assignment(1, 1, 0, 0)], {1}))


def test_incomplete_course_rejected():
    problem = make_problem()
    with pytest.raises(InvalidScheduleError, match="expected 1 sessions"):
        validate_solution(problem, Solution([], {1}))


def test_unknown_scheduled_course_rejected():
    problem = make_problem()
    with pytest.raises(InvalidScheduleError, match="unknown scheduled course"):
        validate_solution(problem, Solution([], {999}))
