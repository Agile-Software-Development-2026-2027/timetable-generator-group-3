"""KAN-57: teacher availability in the ASP engine."""
from datetime import time
from types import SimpleNamespace

import pytest

from app.engine.engine import solve
from app.engine.facts import Problem, availability_slots, build_problem
from app.engine.reasons import unscheduled_course_reason
from app.models import Room, SlotConfig, Teacher, TeacherAvailability


@pytest.fixture()
def setup(session, course):
    """One 1-hour course taught by one teacher, a 3-slot Monday grid, one room."""
    session.add(SlotConfig(id=1, working_days="[0]", start_time=time(9),
                           end_time=time(12), block_minutes=60))
    teacher = Teacher(name="Mario Rossi", identifier="STAFF-1", courses=[course])
    course.weekly_hours = 1
    session.add_all([teacher, Room(code="MT1", capacity=100)])
    session.commit()
    return teacher, course


def entry(teacher, start, end, kind):
    return TeacherAvailability(teacher_id=teacher.id, weekday=0, start_time=time(start),
                               end_time=time(end), availability_type=kind)


def test_ranges_map_to_every_overlapping_slot():
    slots = {(0, 0): (time(9), time(10)), (0, 1): (time(10), time(11)),
             (0, 2): (time(11), time(12)), (1, 0): (time(9), time(10))}
    teacher = SimpleNamespace(id=7)
    half_hours = TeacherAvailability(teacher_id=7, weekday=0, start_time=time(9, 30),
                                     end_time=time(10, 30), availability_type="unavailable")

    unavailable, preferred = availability_slots(
        [half_hours, entry(teacher, 11, 12, "preferred")], slots)

    assert unavailable == {(7, 0, 0), (7, 0, 1)}
    assert preferred == {(7, 0, 2)}


def test_unavailable_slots_become_busy_teacher_facts_and_are_never_used(session, setup):
    teacher, course = setup
    session.add(entry(teacher, 9, 11, "unavailable"))
    session.commit()

    problem = build_problem(session, course.degree_id, None)
    solution = solve(problem)

    assert f"busy_teacher({teacher.id},0,0)." in problem.facts
    assert [(a.day, a.slot) for a in solution.assignments] == [(0, 2)]


def test_with_free_choice_a_preferred_slot_is_chosen(session, setup):
    teacher, course = setup
    session.add(entry(teacher, 10, 11, "preferred"))
    session.commit()

    problem = build_problem(session, course.degree_id, None)
    solution = solve(problem)

    assert f"prefers_slot({teacher.id},0,1)." in problem.facts
    assert [(a.day, a.slot) for a in solution.assignments] == [(0, 1)]


def test_reason_when_unavailability_blocks_every_slot(session, setup):
    teacher, course = setup
    session.add(entry(teacher, 9, 12, "unavailable"))
    session.commit()

    problem = build_problem(session, course.degree_id, None)
    solution = solve(problem)

    assert solution is None or course.id not in solution.scheduled_ids
    assert unscheduled_course_reason(problem, course, solution) == (
        "Teacher availability: Mario Rossi has no available slot for Databases."
    )


def test_preferences_never_make_the_solver_drop_a_course():
    """A 4-hour course outweighs three 1-hour courses that sit in preferred slots."""
    slots = range(4)
    facts = "\n".join([
        "buffer_slots(0).", *(f"slot(0,{s})." for s in slots),
        "room(1,100). room(2,100). room(3,100). room(4,100).",
        "course(10,4). sessions(10,4). group(10,1).",
        "teaches(1,10). teaches(2,10). teaches(3,10).",
        "course(11,1). sessions(11,1). group(11,2). teaches(1,11).",
        "course(12,1). sessions(12,1). group(12,3). teaches(2,12).",
        "course(13,1). sessions(13,1). group(13,4). teaches(3,13).",
        *(f"students({c},10). duration({c},1)." for c in (10, 11, 12, 13)),
        *(f"start_ok({c},0,{s})." for c in (10, 11, 12, 13) for s in slots),
        "prefers_slot(1,0,0). prefers_slot(2,0,0). prefers_slot(3,0,0).",
    ])
    courses = [SimpleNamespace(id=10, semester_id=1, weekly_hours=4)] + [
        SimpleNamespace(id=i, semester_id=i, weekly_hours=1) for i in (11, 12, 13)]
    problem = Problem(courses=courses, rooms=[1, 2, 3, 4],
                      slots={(0, s): (None, None) for s in range(4)},
                      facts=facts, group_capacity={1: 4})

    solution = solve(problem)

    assert solution.scheduled_ids == {10}


def test_an_unavailable_block_blocks_every_session_that_covers_it(session, setup):
    """KAN-52: a 60-minute session on a 30-minute grid spans two blocks."""
    teacher, course = setup
    config = session.get(SlotConfig, 1)
    config.block_minutes, config.end_time = 30, time(11)
    session.add(entry(teacher, 9, 10, "unavailable"))
    session.commit()

    solution = solve(build_problem(session, course.degree_id, None))

    assert [(a.day, a.slot) for a in solution.assignments] == [(0, 2)]
