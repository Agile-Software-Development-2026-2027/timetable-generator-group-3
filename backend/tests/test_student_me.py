"""HTTP tests for personal student endpoints."""

from datetime import time
from uuid import uuid4

import pytest

from app.models import (
    AppUser, Course, Degree, Enrollment, PublishedSession,
    ScheduleSession, Semester, Student, TimetablePublication, Year,
)

PREFIX = "/students/me"
ROUTES = [
    ("GET", "/courses", {}),
    ("GET", "/available-courses", {}),
    ("POST", "/enrollments", {"json": {"course_id": 1}}),
    ("DELETE", "/enrollments/1", {}),
    ("GET", "/timetable-status", {}),
    ("GET", "/timetable", {}),
]


@pytest.mark.parametrize("method,path,options", ROUTES)
def test_requires_authentication(client, method, path, options):
    assert client.request(method, PREFIX + path, **options).status_code == 401


@pytest.mark.parametrize("role", ["director", "teacher"])
@pytest.mark.parametrize("method,path,options", ROUTES)
def test_rejects_non_students(auth_client, role, method, path, options):
    response = auth_client(role).request(method, PREFIX + path, **options)
    assert response.status_code == 403


@pytest.mark.parametrize("method,path,options", ROUTES)
def test_account_without_assigned_profile(client, make_token, method, path, options):
    headers = {"Authorization": f"Bearer {make_token(uuid4())}"}
    response = client.request(method, PREFIX + path, headers=headers, **options)
    assert response.status_code == 403
    assert response.json()["detail"] == "User has no role assigned"


@pytest.fixture
def personal_data(session, course, auth_client):
    year = Year(number=1, semesters=[Semester(number=1)])
    degree = Degree(name="Mathematics", years=[year])
    session.add(degree)
    session.flush()
    extra = Course(
        name="Statistics", degree_id=degree.id, year_id=year.id,
        semester_id=year.semesters[0].id,
        weekly_hours=2, enrolled_students=20,
    )
    students = [
        Student(
            name=f"Student {number}", student_number=f"001{number}",
            degree_id=course.degree_id, year_id=course.year_id,
        )
        for number in (1, 2)
    ]
    session.add_all([extra, *students])
    session.flush()
    session.add(Enrollment(student_id=students[1].id, course_id=extra.id))
    session.commit()
    return students[0], students[1], course, extra, auth_client("student", student=students[0])


@pytest.fixture
def personal_client(personal_data):
    return personal_data[4]


def test_personal_courses(personal_client, personal_data):
    _, _, course, _, _ = personal_data
    response = personal_client.get(PREFIX + "/courses")
    assert response.status_code == 200
    assert [(row["id"], row["is_extra"]) for row in response.json()] == [
        (course.id, False)
    ]


def test_available_courses(personal_client, personal_data):
    _, _, _, extra, _ = personal_data
    response = personal_client.get(PREFIX + "/available-courses")
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [extra.id]


def test_add_enrollment(personal_client, personal_data):
    _, _, _, extra, _ = personal_data
    response = personal_client.post(
        PREFIX + "/enrollments", json={"course_id": extra.id}
    )
    assert response.status_code == 201
    assert response.json()["course_id"] == extra.id
    assert "enrolled_at" in response.json()
    assert personal_client.get(PREFIX + "/available-courses").json() == []
    courses = personal_client.get(PREFIX + "/courses").json()
    assert any(row["id"] == extra.id and row["is_extra"] for row in courses)


def test_remove_enrollment(personal_client, personal_data):
    _, _, _, extra, _ = personal_data
    path = PREFIX + "/enrollments"
    assert personal_client.post(path, json={"course_id": extra.id}).status_code == 201
    response = personal_client.delete(f"{path}/{extra.id}")
    assert response.status_code == 204
    assert response.content == b""
    assert personal_client.get(PREFIX + "/available-courses").json()[0]["id"] == extra.id


def test_duplicate_enrollment(personal_client, personal_data):
    _, _, _, extra, _ = personal_data
    path = PREFIX + "/enrollments"
    assert personal_client.post(path, json={"course_id": extra.id}).status_code == 201
    assert personal_client.post(path, json={"course_id": extra.id}).status_code == 409


def test_derived_course_conflict(personal_client, personal_data):
    _, _, course, _, _ = personal_data
    response = personal_client.post(
        PREFIX + "/enrollments", json={"course_id": course.id}
    )
    assert response.status_code == 409


def test_cannot_supply_another_student_id(personal_client, personal_data):
    _, other, _, extra, _ = personal_data
    response = personal_client.post(
        PREFIX + "/enrollments",
        json={"course_id": extra.id, "student_id": other.id},
    )
    assert response.status_code == 422


def test_cannot_remove_another_students_enrollment(
    session, personal_client, personal_data
):
    _, other, _, extra, _ = personal_data
    response = personal_client.delete(PREFIX + f"/enrollments/{extra.id}")
    assert response.status_code == 404
    assert session.get(Enrollment, (other.id, extra.id)) is not None


def test_publication_status(session, personal_client, personal_data):
    student, _, _, _, _ = personal_data
    path = PREFIX + "/timetable-status"
    assert personal_client.get(path).json() == {"published": False}
    director = AppUser(id=uuid4(), role="director")
    session.add(director)
    session.flush()
    session.add(TimetablePublication(
        degree_id=student.degree_id, published_by=director.id,
    ))
    session.commit()
    assert personal_client.get(path).json() == {"published": True}


def test_only_personal_published_sessions(session, personal_client, personal_data):
    _, _, course, extra, _ = personal_data
    for record in (course, extra):
        session.add(PublishedSession(
            degree_id=record.degree_id, course_id=record.id,
            weekday=0, start_time=time(9), end_time=time(10),
        ))
    session.add(ScheduleSession(
        course_id=course.id, weekday=1,
        start_time=time(11), end_time=time(12),
    ))
    session.commit()
    response = personal_client.get(PREFIX + "/timetable")
    assert response.status_code == 200
    assert response.headers["X-Total-Count"] == "1"
    assert [row["course_id"] for row in response.json()] == [course.id]
    assert response.json()[0]["weekday"] == 0


def test_personal_timetable_pagination(session, personal_client, personal_data):
    _, _, course, _, _ = personal_data
    for day in (0, 1):
        session.add(PublishedSession(
            degree_id=course.degree_id, course_id=course.id,
            weekday=day, start_time=time(9), end_time=time(10),
        ))
    session.commit()
    path = PREFIX + "/timetable"
    for page in (1, 2):
        response = personal_client.get(path, params={"page": page, "page_size": 1})
        assert response.status_code == 200
        assert response.headers["X-Total-Count"] == "2"
        assert [row["weekday"] for row in response.json()] == [page - 1]
    assert personal_client.get(path, params={"page": 0}).status_code == 422


def test_linked_accounts_receive_only_their_own_data(
    session, personal_data, auth_client
):
    _, other, course, extra, first_client = personal_data
    second_client = auth_client("student", student=other)

    for record in (course, extra):
        session.add(PublishedSession(
            degree_id=record.degree_id, course_id=record.id,
            weekday=0, start_time=time(9), end_time=time(10),
        ))
    session.commit()

    first_courses = first_client.get(PREFIX + "/courses")
    second_courses = second_client.get(PREFIX + "/courses")

    assert first_courses.status_code == second_courses.status_code == 200
    assert {row["id"] for row in first_courses.json()} == {course.id}
    assert {row["id"] for row in second_courses.json()} == {course.id, extra.id}

    first_timetable = first_client.get(PREFIX + "/timetable")
    second_timetable = second_client.get(PREFIX + "/timetable")

    assert first_timetable.status_code == second_timetable.status_code == 200
    assert {row["course_id"] for row in first_timetable.json()} == {course.id}
    assert {row["course_id"] for row in second_timetable.json()} == {
        course.id, extra.id,
    }
    assert first_timetable.headers["X-Total-Count"] == "1"
    assert second_timetable.headers["X-Total-Count"] == "2"


@pytest.mark.parametrize("method,path,options", ROUTES)
def test_deleted_student_profile_revokes_access(
    session, personal_data, method, path, options
):
    student, _, _, _, linked_client = personal_data

    assert linked_client.get(PREFIX + "/courses").status_code == 200

    session.delete(student)
    session.commit()

    response = linked_client.request(method, PREFIX + path, **options)
    assert response.status_code == 403
    assert response.json()["detail"] == "User has no role assigned"
