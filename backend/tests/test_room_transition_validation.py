from datetime import time
from types import SimpleNamespace

import pytest

from app.engine.engine import Assignment, Solution
from app.engine.facts import Problem
from app.engine.reasons import unscheduled_course_reason
from app.engine.validation import InvalidScheduleError, validate_solution


def make_course(course_id, semester_id=1, weekly_hours=1):
    return SimpleNamespace(
        id=course_id,
        name=f"Course {course_id}",
        semester_id=semester_id,
        weekly_hours=weekly_hours,
        enrolled_students=20,
        requires_lab=False,
        requires_projector=False,
        teachers=[],
    )


def make_room(room_id):
    return SimpleNamespace(
        id=room_id,
        code=f"R{room_id}",
        capacity=100,
        is_lab=False,
        has_projector=False,
    )


def make_problem(courses, rooms, slot_count=3, buffer_slots=1, day_count=1):
    slots = {
        (day, slot): (time(9 + slot), time(10 + slot))
        for day in range(day_count)
        for slot in range(slot_count)
    }
    return Problem(
        courses=courses,
        rooms=rooms,
        slots=slots,
        facts=f"buffer_slots({buffer_slots}).",
        group_capacity={
            course.semester_id: len(slots)
            for course in courses
        },
    )


def test_validation_rejects_different_rooms_in_adjacent_slots():
    courses = [make_course(1), make_course(2)]
    rooms = [make_room(1), make_room(2)]
    problem = make_problem(courses, rooms)
    solution = Solution(
        assignments=[
            Assignment(1, 1, 0, 0),
            Assignment(2, 2, 0, 1),
        ],
        scheduled_ids={1, 2},
    )

    with pytest.raises(InvalidScheduleError, match="room-transition buffer"):
        validate_solution(problem, solution)


def test_validation_allows_different_rooms_with_one_intervening_slot():
    courses = [make_course(1), make_course(2)]
    rooms = [make_room(1), make_room(2)]
    problem = make_problem(courses, rooms)
    solution = Solution(
        assignments=[
            Assignment(1, 1, 0, 0),
            Assignment(2, 2, 0, 2),
        ],
        scheduled_ids={1, 2},
    )

    validate_solution(problem, solution)


def test_validation_allows_consecutive_slots_in_the_same_room():
    courses = [make_course(1), make_course(2)]
    rooms = [make_room(1)]
    problem = make_problem(courses, rooms)
    solution = Solution(
        assignments=[
            Assignment(1, 1, 0, 0),
            Assignment(2, 1, 0, 1),
        ],
        scheduled_ids={1, 2},
    )

    validate_solution(problem, solution)


def test_validation_does_not_apply_buffer_between_different_groups():
    courses = [make_course(1, semester_id=1), make_course(2, semester_id=2)]
    rooms = [make_room(1), make_room(2)]
    problem = make_problem(courses, rooms)
    solution = Solution(
        assignments=[
            Assignment(1, 1, 0, 0),
            Assignment(2, 2, 0, 1),
        ],
        scheduled_ids={1, 2},
    )

    validate_solution(problem, solution)


def test_validation_does_not_apply_buffer_between_different_days():
    courses = [make_course(1), make_course(2)]
    rooms = [make_room(1), make_room(2)]
    problem = make_problem(courses, rooms, day_count=2)
    solution = Solution(
        assignments=[
            Assignment(1, 1, 0, 0),
            Assignment(2, 2, 1, 1),
        ],
        scheduled_ids={1, 2},
    )

    validate_solution(problem, solution)


def test_reason_identifies_room_transition_as_the_blocking_constraint():
    first = make_course(1)
    second = make_course(2)
    target = make_course(3)
    rooms = [make_room(1), make_room(2)]
    problem = make_problem([first, second, target], rooms, day_count=1)
    solution = Solution(
        assignments=[
            Assignment(1, 1, 0, 0),
            Assignment(2, 2, 0, 2),
        ],
        scheduled_ids={1, 2},
    )

    assert unscheduled_course_reason(problem, target, solution) == (
        "Room transition: no slot leaves 15 minutes to change rooms."
    )
