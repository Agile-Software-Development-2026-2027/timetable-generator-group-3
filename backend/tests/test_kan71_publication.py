"""KAN-71 draft visibility, snapshot isolation and role checks."""
from datetime import time

from app.models import PublishedSession, ScheduleSession, Teacher


def _add_draft(session, course, hour=9):
    record = ScheduleSession(
        course_id=course.id, weekday=0,
        start_time=time(hour), end_time=time(hour + 1)
    )
    session.add(record)
    session.commit()
    return record


def test_teacher_only_sees_published_snapshot(session, course, auth_client):
    draft = _add_draft(session, course)
    teacher_record = Teacher(
    name="Test Teacher",
    identifier="test-teacher-publication",
    )
    course.teachers.append(teacher_record)
    session.add(teacher_record)
    session.commit()
    
    teacher = auth_client("teacher", teacher=teacher_record)
    director = auth_client("director")
    degree = course.degree_id
    path = f"/timetable/sessions?degree_id={degree}"

    assert teacher.get(path).json() == []
    assert len(director.get(path).json()) == 1
    assert director.post(f"/timetable/publish?degree_id={degree}").status_code == 200
    assert len(teacher.get(path).json()) == 1

    draft.start_time = time(10)
    draft.end_time = time(11)
    session.commit()
    assert teacher.get(path).json()[0]["start_time"] == "09:00:00"
    assert director.get(path).json()[0]["start_time"] == "10:00:00"
    assert director.get(f"/timetable/publication?degree_id={degree}").json()[
        "has_unpublished_changes"
    ] is True
    assert director.post(f"/timetable/publish?degree_id={degree}").status_code == 200
    assert teacher.get(path).json()[0]["start_time"] == "10:00:00"
    assert director.get(f"/timetable/publication?degree_id={degree}").json()[
        "has_unpublished_changes"
    ] is False


def test_publish_is_director_only(session, course, auth_client, client):
    _add_draft(session, course)
    path = f"/timetable/publish?degree_id={course.degree_id}"
    assert client.post(path).status_code == 401
    assert auth_client("student").post(path).status_code == 403
    assert auth_client("teacher").post(path).status_code == 403
    assert session.query(PublishedSession).count() == 0


def test_student_cannot_request_draft(session, course, auth_client, client):
    _add_draft(session, course)
    assert client.get("/timetable/sessions").status_code == 401
    assert auth_client("student").get("/timetable/sessions?version=draft").status_code == 403


def test_publish_empty_draft_clears_published(session, course, auth_client):
    draft = _add_draft(session, course)
    director = auth_client("director")
    teacher = auth_client("teacher")
    path = f"/timetable/publish?degree_id={course.degree_id}"
    assert director.post(path).status_code == 200
    session.delete(draft)
    session.commit()
    assert len(teacher.get("/timetable/sessions").json()) == 1
    assert director.post(path).status_code == 200
    assert teacher.get("/timetable/sessions").json() == []

def test_student_cannot_bypass_personal_timetable(session, course, auth_client):
    _add_draft(session, course)
    director = auth_client("director")
    student = auth_client("student")
    degree = course.degree_id

    assert director.post(f"/timetable/publish?degree_id={degree}").status_code == 200
    assert session.query(PublishedSession).count() == 1

    paths = [
        "/timetable/sessions",
        "/timetable/sessions?student=me",
        "/timetable/sessions?version=published",
        f"/timetable/sessions?degree_id={degree}",
        "/timetable/sessions?student=me&page=1&page_size=500",
    ]

    for path in paths:
        response = student.get(path)
        assert response.status_code == 403
        assert response.json()["detail"] == "Students must use /students/me/timetable."
