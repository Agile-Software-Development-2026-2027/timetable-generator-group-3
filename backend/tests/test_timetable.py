import pytest

@pytest.fixture
def director_client(auth_client):
    return auth_client("director")

def session_payload(course_id, **overrides):
    return {
        "course_id": course_id,
        "room_id": None,
        "weekday": 2,
        "start_time": "09:00:00",
        "end_time": "11:00:00",
        **overrides,
    }


def test_list_courses(director_client, course):
    response = director_client.get("/courses")

    assert response.status_code == 200

    courses = response.json()
    assert len(courses) == 1

    listed_course = courses[0]
    assert listed_course["id"] == course.id
    assert listed_course["name"] == "Databases"
    assert listed_course["degree"] == "Computer Science"
    assert listed_course["weekly_hours"] == 4
    assert listed_course["enrolled_students"] == 80


def test_create_list_update_and_delete_session(director_client, course):
    room = director_client.post("/rooms", json={"code": "MT1", "capacity": 110}).json()

    created = director_client.post("/timetable/sessions", json=session_payload(course.id))
    assert created.status_code == 201
    session_id = created.json()["id"]
    assert director_client.get("/timetable/sessions").json() == [created.json()]

    updated = director_client.put(
        f"/timetable/sessions/{session_id}",
        json=session_payload(course.id, room_id=room["id"], weekday=4),
    )
    assert updated.status_code == 200
    assert updated.json()["room_id"] == room["id"]
    assert updated.json()["weekday"] == 4

    assert director_client.delete(f"/timetable/sessions/{session_id}").status_code == 204
    assert director_client.get("/timetable/sessions").json() == []


def test_session_end_must_follow_start(director_client, course):
    response = director_client.post(
        "/timetable/sessions",
        json=session_payload(course.id, start_time="11:00", end_time="09:00"),
    )

    assert response.status_code == 422


def test_session_requires_existing_course(director_client):
    response = director_client.post("/timetable/sessions", json=session_payload(999))

    assert response.status_code == 404
    assert response.json()["detail"] == "Course not found."


def test_missing_session_returns_404(director_client, course):
    response = director_client.put("/timetable/sessions/999", json=session_payload(course.id))

    assert response.status_code == 404
    assert director_client.delete("/timetable/sessions/999").status_code == 404

@pytest.mark.parametrize("role", ["teacher", "student"])
def test_only_directors_can_write_timetable(auth_client, course, role):
    api = auth_client(role)

    payload = session_payload(course.id)

    assert api.post("/timetable/sessions", json=payload).status_code == 403
    assert api.put("/timetable/sessions/999", json=payload).status_code == 403
    assert api.delete("/timetable/sessions/999").status_code == 403
    assert api.delete(
        f"/timetable/sessions?degree_id={course.degree_id}"
    ).status_code == 403


def test_timetable_writes_require_authentication(client, course):
    payload = session_payload(course.id)

    assert client.post("/timetable/sessions", json=payload).status_code == 401
    assert client.put("/timetable/sessions/999", json=payload).status_code == 401
    assert client.delete("/timetable/sessions/999").status_code == 401
    assert client.delete(
        f"/timetable/sessions?degree_id={course.degree_id}"
    ).status_code == 401


def test_students_must_use_personal_timetable(auth_client):
    api = auth_client("student")

    response = api.get("/timetable/sessions")

    assert response.status_code == 403
    assert response.json()["detail"] == (
        "Students must use /students/me/timetable."
    )
