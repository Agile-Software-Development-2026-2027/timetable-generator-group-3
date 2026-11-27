"""KAN-78: a course's weekly hours split into sessions of different lengths."""
from datetime import time
from types import SimpleNamespace

import pytest

from app.engine.engine import Assignment, Solution
from app.engine.facts import Problem, session_lengths
from app.engine.validation import InvalidScheduleError, validate_solution
from app.models import Room, SlotConfig
from tests.test_courses import course_payload

pytestmark = pytest.mark.usefixtures("legacy_director_client")


@pytest.mark.parametrize(
    ("weekly_hours", "longest", "block", "expected"),
    [
        (5, 180, 60, [3, 2]),
        (4, 180, 60, [2, 2]),
        (6, 180, 60, [3, 3]),
        (11, 180, 60, [3, 3, 3, 2]),
        (2, 180, 60, [2]),
        (3, 180, 60, [3]),
        (5, 120, 60, [2, 2, 1]),
        (4, 60, 60, [1, 1, 1, 1]),   # same as before KAN-78
        (6, 120, 30, [4, 4, 4]),     # 2-hour sessions on a 30-minute grid
        (5, 180, 30, [6, 4]),        # whole hours on a 30-minute grid: 3 h + 2 h
        (5, 90, 30, [3, 3, 2, 2]),   # 1.5 + 1.5 + 1 + 1 h
        (5, 60, 90, [1, 1, 1, 1, 1]),  # 60-minute sessions take a whole 90-minute block
    ],
)
def test_weekly_hours_split_evenly_into_the_fewest_sessions(weekly_hours, longest, block, expected):
    course = SimpleNamespace(weekly_hours=weekly_hours, session_duration_minutes=longest)

    assert session_lengths(course, block) == expected


def test_course_api_accepts_a_maximum_that_does_not_divide_the_week(client, course):
    response = client.post("/courses", json=course_payload(
        course, weekly_hours=5, session_duration_minutes=180,
    ))

    assert response.status_code == 201, response.text
    assert response.json()["sessions_per_week"] == 2


def test_generation_saves_a_three_and_a_two_hour_session_on_different_days(
    client, session, course,
):
    session.add_all([
        SlotConfig(id=1, working_days="[0,1,2,3,4]", start_time=time(8, 30),
                   end_time=time(13, 30), block_minutes=60),
        Room(code="MT1", capacity=110),
    ])
    course.weekly_hours = 5
    course.session_duration_minutes = 180
    session.commit()

    result = client.post("/timetable/generate", json={
        "degree_id": course.degree_id, "semester_id": course.semester_id,
    })

    assert result.status_code == 200, result.text
    assert result.json()["status"] == "ok"
    assert result.json()["total_sessions"] == 2
    saved = client.get("/timetable/sessions").json()
    hours = sorted(int(s["end_time"][:2]) - int(s["start_time"][:2]) for s in saved)
    assert hours == [2, 3]
    assert len({s["weekday"] for s in saved}) == 2  # KAN-55: different days


def _problem():
    course = SimpleNamespace(id=1, semester_id=1, weekly_hours=5, enrolled_students=10,
                             requires_lab=False, requires_projector=False, teachers=[])
    room = SimpleNamespace(id=1, capacity=100, is_lab=False, has_projector=False)
    slots = {(d, s): (time(9 + s), time(10 + s)) for d in range(2) for s in range(4)}
    return Problem(courses=[course], rooms=[room], slots=slots, facts="",
                   group_capacity={1: 8}, session_parts={1: [3, 2]})


def test_validation_accepts_the_expected_session_lengths():
    validate_solution(_problem(), Solution(
        [Assignment(1, 1, 0, 0, 3), Assignment(1, 1, 1, 0, 2)], {1},
    ))


def test_validation_rejects_sessions_of_the_wrong_length():
    with pytest.raises(InvalidScheduleError, match="expected"):
        validate_solution(_problem(), Solution(
            [Assignment(1, 1, 0, 0, 3), Assignment(1, 1, 1, 0, 3)], {1},
        ))
