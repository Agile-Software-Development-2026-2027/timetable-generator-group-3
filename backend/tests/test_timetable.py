def session_payload(course_id, **overrides):
    return {
        "course_id": course_id,
        "room_id": None,
        "weekday": 2,
        "start_time": "09:00:00",
        "end_time": "11:00:00",
        **overrides,
    }


def test_list_courses(client, course):
    response = client.get("/courses")

    assert response.status_code == 200
    assert response.json() == [
        {"id": course.id, "name": "Databases", "degree": "Computer Science"}
    ]


def test_create_list_update_and_delete_session(client, course):
    room = client.post("/rooms", json={"code": "MT1", "capacity": 110}).json()

    created = client.post("/timetable/sessions", json=session_payload(course.id))
    assert created.status_code == 201
    session_id = created.json()["id"]
    assert client.get("/timetable/sessions").json() == [created.json()]

    updated = client.put(
        f"/timetable/sessions/{session_id}",
        json=session_payload(course.id, room_id=room["id"], weekday=4),
    )
    assert updated.status_code == 200
    assert updated.json()["room_id"] == room["id"]
    assert updated.json()["weekday"] == 4

    assert client.delete(f"/timetable/sessions/{session_id}").status_code == 204
    assert client.get("/timetable/sessions").json() == []


def test_session_end_must_follow_start(client, course):
    response = client.post(
        "/timetable/sessions",
        json=session_payload(course.id, start_time="11:00", end_time="09:00"),
    )

    assert response.status_code == 422


def test_session_requires_existing_course(client):
    response = client.post("/timetable/sessions", json=session_payload(999))

    assert response.status_code == 404
    assert response.json()["detail"] == "Course not found."


def test_missing_session_returns_404(client, course):
    response = client.put("/timetable/sessions/999", json=session_payload(course.id))

    assert response.status_code == 404
    assert client.delete("/timetable/sessions/999").status_code == 404
