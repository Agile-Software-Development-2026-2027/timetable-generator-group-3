"""KAN-72: teacher workload constraints, preferences and validation."""

from collections import Counter
from datetime import time

import pytest

from app.engine.engine import Assignment, Solution, solve
from app.engine.facts import build_problem, workload_facts, workload_limits
from app.engine.reasons import unscheduled_course_reason
from app.engine.validation import InvalidScheduleError, validate_solution
from app.models import (
    Course,
    Degree,
    Room,
    ScheduleSession,
    Semester,
    SlotConfig,
    Teacher,
    TeacherAvailability,
    TeacherPreferences,
    Year,
)


@pytest.fixture()
def workload_setup(session, course):
    """Create an isolated two-day timetable with one teacher and room."""
    config = SlotConfig(
        id=1,
        working_days="[0,1]",
        start_time=time(9),
        end_time=time(15),
        block_minutes=60,
    )
    teacher = Teacher(
        name="Mario Rossi",
        identifier="WORKLOAD-1",
        courses=[course],
    )
    room = Room(code="WL1", capacity=100)

    course.weekly_hours = 2
    course.session_duration_minutes = 60

    session.add_all([config, teacher, room])
    session.commit()

    return teacher, course, config, room


def configure(session, teacher, **kwargs):
    preferences = TeacherPreferences(
        teacher_id=teacher.id,
        **kwargs,
    )
    session.add(preferences)
    session.commit()
    return preferences


def build(session, course):
    return build_problem(session, course.degree_id, None)


def assert_scheduled(problem, course):
    solution = solve(problem)
    assert solution is not None
    assert course.id in solution.scheduled_ids
    validate_solution(problem, solution)
    return solution


def assert_unscheduled(problem, course):
    solution = solve(problem)
    assert solution is None or course.id not in solution.scheduled_ids
    return solution


def teaching_blocks(problem, solution):
    return {
        covered
        for assignment in solution.assignments
        for covered in problem.covered_slots(
            assignment.course_id,
            assignment.day,
            assignment.slot,
            assignment.blocks,
        )
    }


@pytest.mark.parametrize(
    "block_minutes,expected_daily,expected_consecutive",
    [
        (30, 8, 4),
        (60, 4, 2),
        (40, 6, 3),
        (90, 2, 1),
    ],
)
def test_hour_limits_use_configured_grid(
    block_minutes, expected_daily, expected_consecutive
):
    preferences = TeacherPreferences(
        teacher_id=1,
        max_hours_per_day=4,
        max_consecutive_hours=2,
    )

    workload = workload_limits([preferences], block_minutes)[1]

    assert workload.max_daily_slots == expected_daily
    assert workload.max_consecutive_slots == expected_consecutive
    assert workload.max_hours_per_day == 4
    assert workload.max_consecutive_hours == 2


def test_zero_slot_limit_is_preserved():
    preferences = TeacherPreferences(
        teacher_id=1,
        max_hours_per_day=1,
        max_consecutive_hours=1,
    )

    workload = workload_limits([preferences], 90)[1]

    assert workload.max_daily_slots == 0
    assert workload.max_consecutive_slots == 0


@pytest.mark.parametrize("part", [None, "none"])
def test_unset_preferences_emit_no_workload_constraints(part):
    preferences = TeacherPreferences(
        teacher_id=1,
        preferred_part_of_day=part,
    )

    workloads = workload_limits([preferences], 30)
    slots = {(0, 0): (time(9), time(9, 30))}

    assert workload_facts(workloads, slots, set()) == []


def test_database_preferences_are_loaded_as_facts(session, workload_setup):
    teacher, course, config, _ = workload_setup
    config.block_minutes = 30

    configure(
        session,
        teacher,
        max_hours_per_day=4,
        max_teaching_days=2,
        max_consecutive_hours=2,
        preferred_part_of_day="morning",
    )

    problem = build(session, course)
    workload = problem.teacher_workloads[teacher.id]

    assert problem.block_minutes == 30
    assert workload.max_daily_slots == 8
    assert workload.max_teaching_days == 2
    assert workload.max_consecutive_slots == 4

    assert f"max_daily_slots({teacher.id},8)." in problem.facts
    assert f"max_teaching_days({teacher.id},2)." in problem.facts
    assert f"max_consecutive_slots({teacher.id},4)." in problem.facts
    assert f"prefers_part_slot({teacher.id},0,0)." in problem.facts
    assert f"prefers_part_slot({teacher.id},0,8)." not in problem.facts


def test_teacher_without_preferences_is_scheduled(session, workload_setup):
    _, course, _, _ = workload_setup

    problem = build(session, course)

    assert problem.teacher_workloads == {}
    assert_scheduled(problem, course)


def test_daily_limit_distributes_teaching(session, workload_setup):
    teacher, course, _, _ = workload_setup
    configure(session, teacher, max_hours_per_day=1)

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    counts = Counter(
        day for day, _ in teaching_blocks(problem, solution)
    )

    assert counts == {0: 1, 1: 1}


def test_daily_limit_counts_multiblock_sessions(session, workload_setup):
    teacher, course, config, _ = workload_setup

    config.block_minutes = 30
    course.weekly_hours = 2
    course.session_duration_minutes = 120

    configure(session, teacher, max_hours_per_day=1)

    problem = build(session, course)
    solution = assert_unscheduled(problem, course)

    assert unscheduled_course_reason(problem, course, solution) == (
        "Teacher workload: Mario Rossi cannot teach more than "
        "1 hour on any day."
    )


def test_daily_limit_rejects_excessive_teaching(session, workload_setup):
    teacher, course, config, _ = workload_setup
    config.working_days = "[0]"

    configure(session, teacher, max_hours_per_day=1)

    problem = build(session, course)
    solution = assert_unscheduled(problem, course)

    assert unscheduled_course_reason(problem, course, solution) == (
        "Teacher workload: Mario Rossi cannot teach more than "
        "1 hour on any day."
    )


def test_teaching_days_limit_overrides_session_spreading(
    session, workload_setup
):
    teacher, course, _, _ = workload_setup
    configure(session, teacher, max_teaching_days=1)

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    assert len({a.day for a in solution.assignments}) == 1


def test_teaching_days_limit_rejects_insufficient_capacity(
    session, workload_setup
):
    teacher, course, config, _ = workload_setup
    config.end_time = time(10)

    configure(session, teacher, max_teaching_days=1)

    problem = build(session, course)
    solution = assert_unscheduled(problem, course)

    assert unscheduled_course_reason(problem, course, solution) == (
        "Teacher workload: Mario Rossi cannot teach more than "
        "1 day per week."
    )


def test_consecutive_limit_requires_free_period(session, workload_setup):
    teacher, course, config, _ = workload_setup
    config.working_days = "[0]"
    config.end_time = time(12)

    configure(session, teacher, max_consecutive_hours=1)

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    assert teaching_blocks(problem, solution) == {(0, 0), (0, 2)}


def test_consecutive_limit_rejects_adjacent_sessions(
    session, workload_setup
):
    teacher, course, config, _ = workload_setup
    config.working_days = "[0]"
    config.end_time = time(11)

    configure(session, teacher, max_consecutive_hours=1)

    assert_unscheduled(build(session, course), course)


def test_consecutive_limit_rejects_oversized_session(
    session, workload_setup
):
    teacher, course, _, _ = workload_setup
    course.session_duration_minutes = 120

    configure(session, teacher, max_consecutive_hours=1)

    problem = build(session, course)
    solution = assert_unscheduled(problem, course)

    assert unscheduled_course_reason(problem, course, solution) == (
        "Teacher workload: Mario Rossi cannot teach more than "
        "1 hour consecutively."
    )


def test_lunch_break_interrupts_consecutive_teaching(
    session, workload_setup
):
    teacher, course, config, _ = workload_setup

    config.working_days = "[0]"
    config.start_time = time(11)
    config.end_time = time(14)
    config.break_start = time(12)
    config.break_end = time(13)

    configure(session, teacher, max_consecutive_hours=1)

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    assert len(solution.assignments) == 2

    starts = {
        problem.slots[(a.day, a.slot)][0]
        for a in solution.assignments
    }

    assert starts == {time(11), time(13)}


@pytest.mark.parametrize("part", ["morning", "afternoon"])
def test_part_of_day_preference(session, workload_setup, part):
    teacher, course, _, _ = workload_setup
    configure(session, teacher, preferred_part_of_day=part)

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    for assignment in solution.assignments:
        start = problem.slots[(assignment.day, assignment.slot)][0]

        if part == "morning":
            assert start < time(13)
        else:
            assert start >= time(13)


def test_unavailable_preferred_period_does_not_prevent_scheduling(
    session, workload_setup
):
    teacher, course, config, _ = workload_setup
    config.working_days = "[0]"

    session.add(TeacherAvailability(
        teacher_id=teacher.id,
        weekday=0,
        start_time=time(9),
        end_time=time(13),
        availability_type="unavailable",
    ))

    configure(
        session,
        teacher,
        preferred_part_of_day="morning",
        max_hours_per_day=2,
    )

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    assert teaching_blocks(problem, solution) == {(0, 4), (0, 5)}


@pytest.mark.parametrize(
    "preferences,placements,error",
    [
        (
            {"max_hours_per_day": 1},
            [(0, 0), (0, 2)],
            "maximum daily",
        ),
        (
            {"max_teaching_days": 1},
            [(0, 0), (1, 0)],
            "maximum teaching days",
        ),
        (
            {"max_consecutive_hours": 1},
            [(0, 0), (0, 1)],
            "maximum consecutive",
        ),
    ],
)
def test_independent_validator_rejects_invalid_complete_solution(
    session, workload_setup, preferences, placements, error
):
    teacher, course, _, room = workload_setup

    configure(session, teacher, **preferences)

    problem = build(session, course)

    solution = Solution(
        [
            Assignment(course.id, room.id, day, slot, blocks=1)
            for day, slot in placements
        ],
        {course.id},
    )

    with pytest.raises(InvalidScheduleError, match=error):
        validate_solution(problem, solution)


def test_independent_validator_accepts_valid_complete_solution(
    session, workload_setup
):
    teacher, course, _, room = workload_setup

    configure(
        session,
        teacher,
        max_hours_per_day=1,
        max_teaching_days=2,
        max_consecutive_hours=1,
    )

    problem = build(session, course)

    solution = Solution(
        [
            Assignment(course.id, room.id, 0, 0, blocks=1),
            Assignment(course.id, room.id, 1, 0, blocks=1),
        ],
        {course.id},
    )

    validate_solution(problem, solution)



def add_external_course(session, teacher, room, periods):
    """Create fixed teaching commitments outside the generated degree."""
    degree = Degree(name="External degree")
    year = Year(number=1, degree=degree)
    semester = Semester(number=1, year=year)

    session.add_all([degree, year, semester])
    session.flush()

    course = Course(
        name="External course",
        degree_id=degree.id,
        year_id=year.id,
        semester_id=semester.id,
        weekly_hours=len(periods),
        enrolled_students=20,
        session_duration_minutes=60,
        teachers=[teacher],
    )

    session.add(course)
    session.flush()

    for day, start, end in periods:
        session.add(ScheduleSession(
            course_id=course.id,
            room_id=room.id,
            weekday=day,
            start_time=time(start),
            end_time=time(end),
        ))

    session.commit()
    return course


def add_shared_course(session, course, teacher):
    """Create another course taught by the same teacher."""
    other = Course(
        name="Shared teacher course",
        degree_id=course.degree_id,
        year_id=course.year_id,
        semester_id=course.semester_id,
        weekly_hours=1,
        enrolled_students=20,
        session_duration_minutes=60,
        teachers=[teacher],
    )

    session.add(other)
    session.commit()
    return other


def test_external_teaching_counts_toward_daily_limit(
    session, workload_setup
):
    teacher, course, config, room = workload_setup
    config.working_days = "[0]"

    add_external_course(
        session, teacher, room, [(0, 9, 10)]
    )

    configure(session, teacher, max_hours_per_day=2)

    problem = build(session, course)

    assert problem.external_teaching == {(teacher.id, 0, 0)}
    assert f"external_teaching({teacher.id},0,0)." in problem.facts

    solution = assert_unscheduled(problem, course)

    assert unscheduled_course_reason(problem, course, solution) == (
        "Teacher workload: Mario Rossi cannot teach more than "
        "2 hours on any day."
    )


def test_external_teaching_counts_toward_teaching_days(
    session, workload_setup
):
    teacher, course, _, room = workload_setup

    add_external_course(
        session, teacher, room, [(0, 9, 10)]
    )

    configure(session, teacher, max_teaching_days=1)

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    assert {a.day for a in solution.assignments} == {0}


def test_external_teaching_counts_toward_consecutive_limit(
    session, workload_setup
):
    teacher, course, config, room = workload_setup
    config.working_days = "[0]"
    config.end_time = time(12)
    course.session_duration_minutes = 120

    add_external_course(
        session, teacher, room, [(0, 9, 10)]
    )

    configure(session, teacher, max_consecutive_hours=2)

    problem = build(session, course)
    solution = assert_unscheduled(problem, course)

    assert unscheduled_course_reason(problem, course, solution) == (
        "Teacher workload: Mario Rossi cannot teach more than "
        "2 hours consecutively."
    )


def test_existing_external_daily_violation_allows_another_day(
    session, workload_setup
):
    teacher, course, _, room = workload_setup
    course.weekly_hours = 1

    add_external_course(
        session, teacher, room,
        [(0, 9, 10), (0, 10, 11)],
    )

    configure(session, teacher, max_hours_per_day=1)

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    assert {a.day for a in solution.assignments} == {1}


def test_existing_external_consecutive_violation_allows_separate_run(
    session, workload_setup
):
    teacher, course, config, room = workload_setup
    course.weekly_hours = 1
    config.working_days = "[0]"
    config.end_time = time(13)

    add_external_course(
        session, teacher, room,
        [(0, 9, 10), (0, 10, 11)],
    )

    configure(session, teacher, max_consecutive_hours=1)

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    assert teaching_blocks(problem, solution) == {(0, 3)}


def test_existing_external_teaching_days_violation_is_not_worsened(
    session, workload_setup
):
    teacher, course, config, room = workload_setup
    course.weekly_hours = 1
    config.working_days = "[0,1,2]"

    add_external_course(
        session, teacher, room,
        [(0, 9, 10), (1, 9, 10)],
    )

    configure(session, teacher, max_teaching_days=1)

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    assert {a.day for a in solution.assignments} <= {0, 1}


def test_replaced_sessions_do_not_count_as_external_teaching(
    session, workload_setup
):
    teacher, course, config, room = workload_setup
    config.working_days = "[0]"

    session.add(ScheduleSession(
        course_id=course.id,
        room_id=room.id,
        weekday=0,
        start_time=time(9),
        end_time=time(10),
    ))

    configure(session, teacher, max_hours_per_day=2)

    problem = build(session, course)

    assert problem.external_teaching == set()
    assert_scheduled(problem, course)


def test_daily_limit_is_shared_across_courses(
    session, workload_setup
):
    teacher, course, config, _ = workload_setup
    config.working_days = "[0]"
    other = add_shared_course(session, course, teacher)

    configure(session, teacher, max_hours_per_day=2)

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    assert other.id not in solution.scheduled_ids
    assert len(teaching_blocks(problem, solution)) == 2


def test_consecutive_limit_is_shared_across_courses(
    session, workload_setup
):
    teacher, course, config, _ = workload_setup
    course.weekly_hours = 1
    config.working_days = "[0]"
    config.end_time = time(12)

    other = add_shared_course(session, course, teacher)

    configure(session, teacher, max_consecutive_hours=1)

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    assert solution.scheduled_ids == {course.id, other.id}
    assert teaching_blocks(problem, solution) == {(0, 0), (0, 2)}


def test_teaching_days_limit_is_shared_across_courses(
    session, workload_setup
):
    teacher, course, _, _ = workload_setup
    other = add_shared_course(session, course, teacher)

    configure(session, teacher, max_teaching_days=1)

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    assert solution.scheduled_ids == {course.id, other.id}
    assert len({a.day for a in solution.assignments}) == 1


def test_validator_counts_external_teaching(
    session, workload_setup
):
    teacher, course, config, room = workload_setup
    config.working_days = "[0]"

    add_external_course(
        session, teacher, room, [(0, 9, 10)]
    )

    configure(session, teacher, max_hours_per_day=2)

    problem = build(session, course)

    solution = Solution(
        [
            Assignment(course.id, room.id, 0, 1, blocks=1),
            Assignment(course.id, room.id, 0, 2, blocks=1),
        ],
        {course.id},
    )

    with pytest.raises(InvalidScheduleError, match="maximum daily"):
        validate_solution(problem, solution)


def test_validator_counts_workload_across_courses(
    session, workload_setup
):
    teacher, course, _, room = workload_setup
    course.weekly_hours = 1
    other = add_shared_course(session, course, teacher)

    configure(session, teacher, max_consecutive_hours=1)

    problem = build(session, course)

    solution = Solution(
        [
            Assignment(course.id, room.id, 0, 0, blocks=1),
            Assignment(other.id, room.id, 0, 1, blocks=1),
        ],
        {course.id, other.id},
    )

    with pytest.raises(InvalidScheduleError, match="maximum consecutive"):
        validate_solution(problem, solution)


def test_session_spreading_has_priority_over_part_of_day(
    session, workload_setup
):
    teacher, course, _, _ = workload_setup

    session.add(TeacherAvailability(
        teacher_id=teacher.id,
        weekday=1,
        start_time=time(9),
        end_time=time(13),
        availability_type="unavailable",
    ))

    configure(session, teacher, preferred_part_of_day="morning")

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    assert {a.day for a in solution.assignments} == {0, 1}


def test_part_of_day_preference_does_not_reduce_completeness(
    session, workload_setup
):
    teacher, course, config, _ = workload_setup

    config.working_days = "[0]"
    config.start_time = time(12)
    config.end_time = time(14)

    other = add_shared_course(session, course, teacher)

    configure(session, teacher, preferred_part_of_day="morning")

    problem = build(session, course)
    solution = assert_scheduled(problem, course)

    assert solution.scheduled_ids == {course.id}
    assert other.id not in solution.scheduled_ids
    assert teaching_blocks(problem, solution) == {(0, 0), (0, 1)}


def test_generation_endpoint_reports_workload_conflict(
    client, session, workload_setup, legacy_director_client
):
    teacher, course, config, _ = workload_setup
    config.working_days = "[0]"

    configure(session, teacher, max_hours_per_day=1)

    response = client.post(
        "/timetable/generate",
        json={"degree_id": course.degree_id},
    )

    assert response.status_code == 200, response.text

    body = response.json()

    assert body["status"] == "infeasible"
    assert body["sessions_created"] == 0
    assert len(body["unscheduled"]) == 1
    assert body["unscheduled"][0]["course_id"] == course.id
    assert body["unscheduled"][0]["reason"] == (
        "Teacher workload: Mario Rossi cannot teach more than "
        "1 hour on any day."
    )
