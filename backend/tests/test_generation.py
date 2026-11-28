"""KAN-15 endpoint integration checks (uses the project's SQLite test fixtures)."""
import pytest
from datetime import time
from types import SimpleNamespace

from app.engine.facts import Problem
from app.engine.reasons import unscheduled_course_reason
from app.models import AppUser, Course, Degree, Room, ScheduleSession, Semester, Year

@pytest.fixture()
def director_generation_client(director_client, session, course):
    director = session.query(AppUser).filter_by(role="director").one()
    director.degrees.append(session.get(Degree, course.degree_id))
    session.commit()
    return director_client

def test_generation_creates_exact_hours_and_can_regenerate(director_generation_client, session, course):
    session.add(Room(code="MT1", capacity=110, is_lab=False, has_projector=True))
    session.commit()
    payload = {"degree_id": course.degree_id, "semester_id": course.semester_id}

    first = director_generation_client.post("/timetable/generate", json=payload)
    assert first.status_code == 200, first.text
    assert first.json() == {"status": "ok", "sessions_created": 4, "unscheduled": []}

    second = director_generation_client.post("/timetable/generate", json=payload)
    assert second.status_code == 200, second.text
    assert second.json()["sessions_created"] == 4
    sessions = director_generation_client.get("/timetable/sessions").json()
    assert len(sessions) == 4  # replacement rather than duplication
    assert len({(s["weekday"], s["start_time"]) for s in sessions}) == 4


def test_no_eligible_room_does_not_erase_existing_schedule(director_generation_client, session, course):
    room = Room(code="SMALL", capacity=10)
    session.add(room)
    session.flush()
    session.add(ScheduleSession(course_id=course.id, room_id=room.id,
                                weekday=0, start_time=time(9),
                                end_time=time(10)))
    session.commit()
    result = director_generation_client.post("/timetable/generate", json={"degree_id": course.degree_id})
    assert result.status_code == 200
    assert result.json()["status"] == "infeasible"
    assert result.json()["sessions_created"] == 0
    assert result.json()["unscheduled"][0]["reason"] == (
        "Room capacity: No room fits 80 students: SMALL (10 seats)."
    )
    assert len(director_generation_client.get("/timetable/sessions").json()) == 1


def test_over_capacity_lab_returns_partial_and_saves_only_valid_sessions(
    director_generation_client, session, course,
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

    result = director_generation_client.post("/timetable/generate", json={"degree_id": course.degree_id})

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

    saved = director_generation_client.get("/timetable/sessions").json()
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
        "Grid capacity: Grid has 1 slot; this semester needs 2 weekly hours."
    )


def test_generation_preserves_outside_scope(director_generation_client, session, course):
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

    result = director_generation_client.post("/timetable/generate", json={"degree_id": course.degree_id})
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "ok"
    saved = director_generation_client.get("/timetable/sessions").json()
    assert len(saved) == 4

    outside_session = session.query(ScheduleSession).filter_by(
        course_id=other.id
    ).one_or_none()
    assert outside_session is not None
    assert outside_session.weekday == 0
    assert outside_session.start_time == time(9)

def test_missing_degree_returns_404(director_client):
    result = director_client.post("/timetable/generate", json={"degree_id": 99999})
    assert result.status_code == 404


def test_clear_removes_only_selected_degree_and_allows_regenerate(director_generation_client, session, course):
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

    generated = director_generation_client.post("/timetable/generate", json={"degree_id": course.degree_id})
    assert generated.json()["sessions_created"] == 4

    visible = director_generation_client.get("/timetable/sessions").json()
    assert len(visible) == 4

    other_session = session.query(ScheduleSession).filter_by(
        course_id=other.id
    ).one_or_none()
    assert other_session is not None

    cleared = director_generation_client.delete(f"/timetable/sessions?degree_id={course.degree_id}")
    assert cleared.status_code == 204
    remaining = session.query(ScheduleSession).filter_by(
        course_id=other.id
    ).one_or_none()
    assert remaining is not None
    regenerated = director_generation_client.post("/timetable/generate", json={"degree_id": course.degree_id})
    assert regenerated.json() == {"status": "ok", "sessions_created": 4, "unscheduled": []}


def test_clear_requires_existing_degree(director_client):
    assert director_client.delete("/timetable/sessions").status_code == 422
    assert director_client.delete("/timetable/sessions?degree_id=99999").status_code == 404


def test_generation_preserves_other_semesters_in_same_degree(director_generation_client, session, course):
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

    result = director_generation_client.post(
        "/timetable/generate",
        json={
            "degree_id": course.degree_id,
            "semester_id": course.semester_id,
        },
    )

    assert result.status_code == 200, result.text

    saved = director_generation_client.get("/timetable/sessions").json()
    other_sessions = [
        item for item in saved if item["course_id"] == other_course.id
    ]

    assert len(other_sessions) == 1
    assert other_sessions[0]["weekday"] == 4
    assert other_sessions[0]["start_time"] == "14:00:00"


def test_generation_rejects_semester_from_another_degree(director_generation_client, session, course):
    other_degree = Degree(name="Mathematics")
    other_year = Year(number=1, degree=other_degree)
    other_semester = Semester(number=1, year=other_year)

    session.add(other_degree)
    session.commit()

    response = director_generation_client.post(
        "/timetable/generate",
        json={
            "degree_id": course.degree_id,
            "semester_id": other_semester.id,
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Semester not found in selected degree."
