"""KAN-15 endpoint integration checks (uses the project's SQLite test fixtures)."""

import pytest
from datetime import time
from types import SimpleNamespace

from app.engine.facts import Problem
from app.engine.reasons import unscheduled_course_reason
from app.models import Course, Degree, Room, ScheduleSession, Semester, SlotConfig, Year


def test_generation_creates_exact_hours_and_can_regenerate(client, session, course):
    session.add(Room(code="MT1", capacity=110, is_lab=False, has_projector=True))
    session.commit()
    payload = {"degree_id": course.degree_id, "semester_id": course.semester_id}

    first = client.post("/timetable/generate", json=payload)
    assert first.status_code == 200, first.text
    assert first.json() == {"status": "ok", "sessions_created": 4, "total_sessions": 4, "unscheduled": []}

    second = client.post("/timetable/generate", json=payload)
    assert second.status_code == 200, second.text
    assert second.json()["sessions_created"] == 4
    sessions = client.get("/timetable/sessions").json()
    assert len(sessions) == 4  # replacement rather than duplication
    assert len({(s["weekday"], s["start_time"]) for s in sessions}) == 4


def test_no_eligible_room_does_not_erase_existing_schedule(client, session, course):
    room = Room(code="SMALL", capacity=10)
    session.add(room)
    session.flush()
    session.add(ScheduleSession(course_id=course.id, room_id=room.id,
                                weekday=0, start_time=time(9),
                                end_time=time(10)))
    session.commit()
    result = client.post("/timetable/generate", json={"degree_id": course.degree_id})
    assert result.status_code == 200
    assert result.json()["status"] == "infeasible"
    assert result.json()["sessions_created"] == 0
    assert result.json()["unscheduled"][0]["reason"] == (
        "Room capacity: No room fits 80 students: SMALL (10 seats)."
    )
    assert len(client.get("/timetable/sessions").json()) == 1


def test_over_capacity_lab_returns_partial_and_saves_only_valid_sessions(
    client, session, course,
):
    lecture_room = Room(code="LECTURE", capacity=110)
    undersized_lab = Room(code="SMALL-LAB", capacity=40, is_lab=True)
    smaller_lab = Room(code="TINY-LAB", capacity=20, is_lab=True)
    lab_course = Course(
        name="Overcapacity Laboratory",
        degree_id=course.degree_id,
        year_id=course.year_id,
        semester_id=course.semester_id,
        weekly_hours=2,
        enrolled_students=60,
        requires_lab=True,
    )
    session.add_all([lecture_room, undersized_lab, smaller_lab, lab_course])
    session.commit()

    result = client.post("/timetable/generate", json={"degree_id": course.degree_id})

    assert result.status_code == 200, result.text
    body = result.json()
    assert body["status"] == "partial"
    assert body["sessions_created"] == course.weekly_hours
    assert len(body["unscheduled"]) == 1
    assert body["unscheduled"][0]["course_id"] == lab_course.id
    assert body["unscheduled"][0]["name"] == "Overcapacity Laboratory"
    assert body["unscheduled"][0]["reason"] == (
        "Lab capacity: No lab fits 60 students. Largest available lab: "
        "SMALL-LAB (40 seats)."
    )
    assert "TINY-LAB" not in body["unscheduled"][0]["reason"]

    saved = client.get("/timetable/sessions").json()
    assert len(saved) == course.weekly_hours
    assert all(item["course_id"] == course.id for item in saved)
    assert all(item["room_code"] == "LECTURE" for item in saved)


def test_unscheduled_reason_identifies_teacher_and_grid_constraints():
    teacher = SimpleNamespace(id=2, name="Carlo Adornetto")
    room = SimpleNamespace(
        id=1, code="LECTURE", capacity=100, is_lab=False, has_projector=False,
    )
    course = SimpleNamespace(
        id=1, name="Example", semester_id=1, weekly_hours=1,
        enrolled_students=20, requires_lab=False, requires_projector=False,
        teachers=[teacher],
    )
    problem = Problem(
        courses=[course], rooms=[room], slots={(0, 0): (time(9), time(10))},
        facts="", group_capacity={1: 1}, busy_teachers={(teacher.id, 0, 0)},
    )
    assert unscheduled_course_reason(problem, course, None) == (
        "Teacher availability: Carlo Adornetto has no free slots."
    )

    course.teachers = []
    course.weekly_hours = 2
    problem.busy_teachers.clear()
    assert unscheduled_course_reason(problem, course, None) == (
        "Grid capacity: Grid has 1 slot of 60 min; this semester needs 2 slots."
    )


def test_generation_preserves_outside_scope(client, session, course):
    other_degree = Degree(name="Different degree")
    other_year = Year(number=1, degree=other_degree)
    other_sem = Semester(number=1, year=other_year)
    session.add_all([other_degree, other_year, other_sem])
    session.flush()
    other = Course(name="Other course", degree_id=other_degree.id,
                   year_id=other_year.id, semester_id=other_sem.id,
                   weekly_hours=1, enrolled_students=20)
    room = Room(code="MT1", capacity=110)
    session.add_all([other, room])
    session.flush()
    session.add(ScheduleSession(course_id=other.id, room_id=room.id,
                                weekday=0, start_time=time(9), end_time=time(10)))
    session.commit()

    result = client.post("/timetable/generate", json={"degree_id": course.degree_id})
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "ok"
    saved = client.get("/timetable/sessions").json()
    assert len(saved) == 5
    assert any(s["course_id"] == other.id and s["weekday"] == 0
               and s["start_time"].startswith("09:00") for s in saved)
    assert not any(s["course_id"] == course.id and s["weekday"] == 0
                   and s["start_time"].startswith("09:00") and s["room_id"] == room.id
                   for s in saved)


def test_missing_degree_returns_404(client):
    result = client.post("/timetable/generate", json={"degree_id": 99999})
    assert result.status_code == 404


def test_clear_removes_only_selected_degree_and_allows_regenerate(client, session, course):
    other_degree = Degree(name="Different degree")
    other_year = Year(number=1, degree=other_degree)
    other_sem = Semester(number=1, year=other_year)
    session.add_all([other_degree, other_year, other_sem])
    session.flush()
    other = Course(name="Other course", degree_id=other_degree.id,
                   year_id=other_year.id, semester_id=other_sem.id,
                   weekly_hours=1, enrolled_students=20)
    session.add_all([other, Room(code="MT1", capacity=110)])
    session.flush()
    session.add(ScheduleSession(course_id=other.id, weekday=0,
                                start_time=time(9), end_time=time(10)))
    session.commit()

    generated = client.post("/timetable/generate", json={"degree_id": course.degree_id})
    assert generated.json()["sessions_created"] == 4
    assert len(client.get("/timetable/sessions").json()) == 5

    cleared = client.delete(f"/timetable/sessions?degree_id={course.degree_id}")
    assert cleared.status_code == 204
    remaining = client.get("/timetable/sessions").json()
    assert [s["course_id"] for s in remaining] == [other.id]

    regenerated = client.post("/timetable/generate", json={"degree_id": course.degree_id})
    assert regenerated.json() == {"status": "ok", "sessions_created": 4, "total_sessions": 4, "unscheduled": []}


def test_clear_requires_existing_degree(client):
    assert client.delete("/timetable/sessions").status_code == 422
    assert client.delete("/timetable/sessions?degree_id=99999").status_code == 404


def test_generation_preserves_other_semesters_in_same_degree(client, session, course):
    room = Room(code="MT1", capacity=110, is_lab=False, has_projector=True)
    other_semester = Semester(number=2, year_id=course.year_id)
    session.add_all([room, other_semester])
    session.flush()

    other_course = Course(
        name="Other semester course",
        degree_id=course.degree_id,
        year_id=course.year_id,
        semester_id=other_semester.id,
        weekly_hours=2,
        enrolled_students=30,
    )
    session.add(other_course)
    session.flush()

    existing_session = ScheduleSession(
        course_id=other_course.id,
        room_id=room.id,
        weekday=4,
        start_time=time(14),
        end_time=time(16),
    )
    session.add(existing_session)
    session.commit()

    result = client.post(
        "/timetable/generate",
        json={
            "degree_id": course.degree_id,
            "semester_id": course.semester_id,
        },
    )

    assert result.status_code == 200, result.text

    saved = client.get("/timetable/sessions").json()
    other_sessions = [
        item for item in saved if item["course_id"] == other_course.id
    ]

    assert len(other_sessions) == 1
    assert other_sessions[0]["weekday"] == 4
    assert other_sessions[0]["start_time"] == "14:00:00"


def test_generation_rejects_semester_from_another_degree(client, session, course):
    other_degree = Degree(name="Mathematics")
    other_year = Year(number=1, degree=other_degree)
    other_semester = Semester(number=1, year=other_year)

    session.add(other_degree)
    session.commit()

    response = client.post(
        "/timetable/generate",
        json={
            "degree_id": course.degree_id,
            "semester_id": other_semester.id,
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Semester not found in selected degree."


def _minutes(value):
    hours, minutes, _ = (int(part) for part in value.split(":"))
    return hours * 60 + minutes


# KAN-52: on a 30-minute grid a 60-minute session spans two consecutive blocks
# and is saved as one row with its real start and end time.
def test_generation_saves_real_start_and_end_of_multi_block_sessions(
    client, session, course,
):
    session.add_all([
        Room(code="MT1", capacity=110, is_lab=False, has_projector=True),
        SlotConfig(id=1, working_days="[0,1,2,3,4]", start_time=time(9),
                   end_time=time(18), block_minutes=30),
    ])
    session.commit()

    result = client.post(
        "/timetable/generate",
        json={"degree_id": course.degree_id, "semester_id": course.semester_id},
    )

    assert result.status_code == 200, result.text
    assert result.json()["sessions_created"] == course.weekly_hours
    saved = [s for s in client.get("/timetable/sessions").json()
             if s["course_id"] == course.id]
    assert len(saved) == course.weekly_hours
    for item in saved:
        assert _minutes(item["end_time"]) - _minutes(item["start_time"]) == 60
        assert _minutes(item["start_time"]) % 30 == 0
    total = sum(_minutes(s["end_time"]) - _minutes(s["start_time"]) for s in saved)
    assert total == course.weekly_hours * 60  # all weekly hours, not half of them

pytestmark = pytest.mark.usefixtures("legacy_director_client")


def test_total_sessions_counts_only_the_generated_semester_in_sessions(
    client, session, course,
):
    """KAN-77: the summary total is the scope's sessions, not the degree's hours."""
    other_semester = Semester(number=2, year_id=course.year_id)
    session.add_all([Room(code="MT1", capacity=110), other_semester])
    session.flush()
    session.add_all([
        Course(name="Long sessions", degree_id=course.degree_id, year_id=course.year_id,
               semester_id=course.semester_id, weekly_hours=6, enrolled_students=30,
               session_duration_minutes=120),
        Course(name="Other semester", degree_id=course.degree_id, year_id=course.year_id,
               semester_id=other_semester.id, weekly_hours=5, enrolled_students=30),
    ])
    session.commit()

    result = client.post("/timetable/generate", json={
        "degree_id": course.degree_id, "semester_id": course.semester_id,
    })

    assert result.status_code == 200, result.text
    # The fixture course has 4 one-hour sessions; 6 hours in 2-hour sessions is 3.
    assert result.json()["total_sessions"] == 7


def test_grid_capacity_reason_explains_rounded_up_sessions():
    """KAN-77: 60-minute sessions on a 90-minute grid take a whole slot each."""
    course = SimpleNamespace(
        id=1, name="Virtual Reality", semester_id=1, weekly_hours=3,
        session_duration_minutes=60, enrolled_students=20,
        requires_lab=False, requires_projector=False, teachers=[],
    )
    room = SimpleNamespace(id=1, code="MT1", capacity=100, is_lab=False, has_projector=False)
    slots = {(0, 0): (time(8, 30), time(10)), (0, 1): (time(10), time(11, 30))}
    problem = Problem(courses=[course], rooms=[room], slots=slots, facts="",
                      group_capacity={1: 2}, session_blocks={1: 1}, sessions_per_week={1: 3})

    assert unscheduled_course_reason(problem, course, None) == (
        "Grid capacity: Grid has 2 slots of 90 min; this semester needs 3 slots. "
        "Sessions of 60 minutes are rounded up to whole 90-minute slots."
    )
