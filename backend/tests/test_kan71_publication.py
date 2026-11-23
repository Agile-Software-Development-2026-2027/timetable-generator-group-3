"""KAN-71 draft visibility, snapshot isolation and role checks."""
from datetime import time

from app.models import PublishedSession, ScheduleSession


def _add_draft(session, course, hour=9):
    record = ScheduleSession(
        course_id=course.id, weekday=0,
        start_time=time(hour), end_time=time(hour + 1)
    )
    session.add(record)
    session.commit()
    return record


def test_student_only_sees_published_snapshot(session, course, auth_client):
    draft = _add_draft(session, course)
    student = auth_client("student")
    director = auth_client("director")
    degree = course.degree_id
    path = f"/timetable/sessions?degree_id={degree}"

    assert student.get(path).json() == []
    assert len(director.get(path).json()) == 1
    assert director.post(f"/timetable/publish?degree_id={degree}").status_code == 200
    assert len(student.get(path).json()) == 1

    draft.start_time = time(10)
    draft.end_time = time(11)
    session.commit()
    assert student.get(path).json()[0]["start_time"] == "09:00:00"
    assert director.get(path).json()[0]["start_time"] == "10:00:00"
    assert director.get(f"/timetable/publication?degree_id={degree}").json()[
        "has_unpublished_changes"
    ] is True
    assert director.post(f"/timetable/publish?degree_id={degree}").status_code == 200
    assert student.get(path).json()[0]["start_time"] == "10:00:00"
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
    student = auth_client("student")
    path = f"/timetable/publish?degree_id={course.degree_id}"
    assert director.post(path).status_code == 200
    session.delete(draft)
    session.commit()
    assert len(student.get("/timetable/sessions").json()) == 1
    assert director.post(path).status_code == 200
    assert student.get("/timetable/sessions").json() == []