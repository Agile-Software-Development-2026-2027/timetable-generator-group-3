import pytest

from app.models import Course, ScheduleSession


def course_payload(course, **overrides):
    return {
        "name": "Software Engineering",
        "degree_id": course.degree_id,
        "year_id": course.year_id,
        "semester_id": course.semester_id,
        "weekly_hours": 6,
        "enrolled_students": 100,
        "requires_lab": True,
        "requires_projector": False,
        **overrides,
    }


# --- Create -------------------------------------------------------------------


def test_create_course(client, session, course):
    response = client.post("/courses", json=course_payload(course))

    assert response.status_code == 201, response.text
    body = response.json()

    assert isinstance(body.pop("id"), int)
    assert body["name"] == "Software Engineering"
    assert body["weekly_hours"] == 6
    assert body["enrolled_students"] == 100
    assert body["requires_lab"] is True
    assert body["requires_projector"] is False
    assert session.query(Course).count() == 2


def test_create_course_trims_name(client, course):
    response = client.post(
        "/courses",
        json=course_payload(course, name="  Software Engineering  "),
    )

    assert response.status_code == 201
    assert response.json()["name"] == "Software Engineering"


@pytest.mark.parametrize("field", ["weekly_hours", "enrolled_students"])
@pytest.mark.parametrize("value", [0, -1, "abc", 1.5])
def test_invalid_positive_integer_fields_are_rejected(
    client, course, field, value
):
    response = client.post(
        "/courses",
        json=course_payload(course, **{field: value}),
    )

    assert response.status_code == 422


def test_blank_course_name_is_rejected(client, course):
    response = client.post(
        "/courses",
        json=course_payload(course, name="   "),
    )

    assert response.status_code == 422


def test_duplicate_course_name_is_rejected(client, course):
    payload = course_payload(course)

    first = client.post("/courses", json=payload)
    assert first.status_code == 201

    response = client.post(
        "/courses",
        json=course_payload(course, name="software engineering"),
    )

    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_course_rejects_year_from_another_degree(client, course):
    response = client.post(
        "/courses",
        json=course_payload(course, year_id=999),
    )

    assert response.status_code == 400


def test_course_rejects_semester_from_another_year(client, course):
    response = client.post(
        "/courses",
        json=course_payload(course, semester_id=999),
    )

    assert response.status_code == 400


# --- List and view ------------------------------------------------------------


def test_list_courses_shows_course_details(client, course):
    response = client.get("/courses")

    assert response.status_code == 200
    rows = response.json()

    assert len(rows) == 1
    assert rows[0]["name"] == "Databases"
    assert rows[0]["weekly_hours"] == 4
    assert rows[0]["enrolled_students"] == 80
    assert rows[0]["degree"] == "Computer Science"
    assert rows[0]["year"] == 1
    assert rows[0]["semester"] == 1


def test_list_courses_supports_academic_filters(client, course):
    response = client.get(
        "/courses",
        params={
            "degree_id": course.degree_id,
            "year_id": course.year_id,
            "semester_id": course.semester_id,
        },
    )

    assert response.status_code == 200
    assert [row["name"] for row in response.json()] == ["Databases"]


def test_get_unknown_course_returns_404(client):
    response = client.get("/courses/999")

    assert response.status_code == 404


# --- Update -------------------------------------------------------------------


def test_update_course(client, course):
    response = client.put(
        f"/courses/{course.id}",
        json=course_payload(
            course,
            name="Advanced Databases",
            weekly_hours=8,
            enrolled_students=120,
            requires_lab=False,
            requires_projector=True,
        ),
    )

    assert response.status_code == 200, response.text
    body = response.json()

    assert body["name"] == "Advanced Databases"
    assert body["weekly_hours"] == 8
    assert body["enrolled_students"] == 120
    assert body["requires_lab"] is False
    assert body["requires_projector"] is True


def test_update_course_rejects_invalid_hours(client, course):
    response = client.put(
        f"/courses/{course.id}",
        json=course_payload(course, weekly_hours=0),
    )

    assert response.status_code == 422


def test_update_unknown_course_returns_404(client, course):
    response = client.put(
        "/courses/999",
        json=course_payload(course),
    )

    assert response.status_code == 404


# --- Delete -------------------------------------------------------------------


def test_delete_course(client, course):
    response = client.delete(f"/courses/{course.id}")

    assert response.status_code == 204
    assert client.get(f"/courses/{course.id}").status_code == 404


def test_delete_course_used_in_timetable_warns_first(
    client, session, course
):
    scheduled = ScheduleSession(
        course_id=course.id,
        weekday=0,
        start_time="09:00",
        end_time="11:00",
    )
    session.add(scheduled)
    session.commit()

    response = client.delete(f"/courses/{course.id}")

    assert response.status_code == 409
    assert "Confirm to delete it anyway" in response.json()["detail"]
    assert client.get(f"/courses/{course.id}").status_code == 200


def test_force_delete_course_removes_timetable_sessions(
    client, session, course
):
    scheduled = ScheduleSession(
        course_id=course.id,
        weekday=0,
        start_time="09:00",
        end_time="11:00",
    )
    session.add(scheduled)
    session.commit()

    response = client.delete(f"/courses/{course.id}?force=true")

    assert response.status_code == 204
    assert session.query(ScheduleSession).count() == 0
    assert client.get(f"/courses/{course.id}").status_code == 404


def test_delete_unknown_course_returns_404(client):
    response = client.delete("/courses/999")

    assert response.status_code == 404

