"""KAN-52: session length facts (duration, sessions, start_ok) built from the grid."""
from datetime import time
from types import SimpleNamespace

import pytest

from app.engine.facts import build_problem, session_shape, start_slots
from app.models import SlotConfig


def _grid(day_slots):
    """Build {(day, index): (start, end)} with 1-hour blocks from 09:00."""
    return {
        (day, index): (time(9 + index), time(10 + index))
        for day, count in day_slots.items()
        for index in range(count)
    }


@pytest.mark.parametrize(
    ("weekly_hours", "minutes", "block_minutes", "expected"),
    [
        (4, None, 60, (1, 4)),   # no session length yet: one hour per session
        (4, None, 30, (2, 4)),   # 60-minute sessions on a 30-minute grid
        (4, 120, 30, (4, 2)),    # two 2-hour sessions
        (3, 90, 30, (3, 2)),     # two 1.5-hour sessions
        (6, 180, 60, (3, 2)),    # two 3-hour sessions
        (4, 60, 90, (1, 4)),     # longer blocks round up to one block
    ],
)
def test_session_shape(weekly_hours, minutes, block_minutes, expected):
    course = SimpleNamespace(weekly_hours=weekly_hours, session_duration_minutes=minutes)
    assert session_shape(course, block_minutes) == expected


def test_session_shape_without_duration_attribute():
    # Courses created before KAN-51 have no session_duration_minutes at all.
    assert session_shape(SimpleNamespace(weekly_hours=2), 30) == (2, 2)


def test_start_slots_never_cross_the_end_of_the_day():
    slots = _grid({0: 3, 1: 1})

    assert start_slots(slots, 1) == [(0, 0), (0, 1), (0, 2), (1, 0)]
    assert start_slots(slots, 2) == [(0, 0), (0, 1)]
    assert start_slots(slots, 3) == [(0, 0)]
    assert start_slots(slots, 4) == []


def test_start_slots_never_cross_a_gap_in_the_grid():
    slots = _grid({0: 4})
    # Lunch break: slot 2 starts at 12:00 but slot 1 ends at 11:00.
    slots[(0, 2)] = (time(12), time(13))
    slots[(0, 3)] = (time(13), time(14))

    assert start_slots(slots, 2) == [(0, 0), (0, 2)]


def test_build_problem_emits_duration_sessions_and_start_ok(session, course):
    session.add(SlotConfig(id=1, working_days="[0]", start_time=time(9),
                           end_time=time(11), block_minutes=30))
    session.commit()

    problem = build_problem(session, course.degree_id, course.semester_id)

    # weekly_hours=4 with the default 60-minute session on a 30-minute grid.
    assert f"duration({course.id},2)." in problem.facts
    assert f"sessions({course.id},4)." in problem.facts
    starts = sorted(
        line for line in problem.facts.splitlines() if line.startswith("start_ok(")
    )
    # Four 30-minute slots 09:00-11:00: a 2-block session can start in 0, 1 or 2.
    assert starts == [f"start_ok({course.id},0,{index})." for index in (0, 1, 2)]
    assert problem.blocks_of(course.id) == 2
    assert problem.sessions_of(course) == 4
    assert problem.required_blocks(course) == 8
    assert problem.covered_slots(course.id, 0, 1) == [(0, 1), (0, 2)]
