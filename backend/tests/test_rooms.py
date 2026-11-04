import pytest

from app.models import Room, ScheduleSession

LECTURE_HALL = {
    "code": "MT1",
    "capacity": 110,
    "has_projector": True,
    "has_computers": False,
    "is_lab": False,
}
PC_LAB = {
    "code": "LAB-A",
    "capacity": 30,
    "has_projector": True,
    "has_computers": True,
    "is_lab": True,
}
SEMINAR_ROOM = {
    "code": "MT8",
    "capacity": 28,
    "has_projector": False,
    "has_computers": False,
    "is_lab": False,
}


def create_room(client, **overrides):
    response = client.post("/rooms", json={**LECTURE_HALL, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


def schedule(client, course_id, room_id):
    response = client.post(
        "/timetable/sessions",
        json={
            "course_id": course_id,
            "room_id": room_id,
            "weekday": 0,
            "start_time": "09:00",
            "end_time": "11:00",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def error_text(response) -> str:
    detail = response.json()["detail"]
    if isinstance(detail, list):
        return " ".join(issue["msg"] for issue in detail)
    return detail


# --- Create -------------------------------------------------------------------


def test_create_room_returns_all_fields(client):
    response = client.post("/rooms", json=PC_LAB)

    assert response.status_code == 201
    body = response.json()
    assert isinstance(body.pop("id"), int)
    assert body == {**PC_LAB, "scheduled_sessions": 0}


def test_create_room_persists_it(client, session):
    room = create_room(client)

    stored = session.get(Room, room["id"])
    assert stored.code == "MT1"
    assert stored.capacity == 110
    assert stored.has_projector is True


def test_feature_flags_default_to_false(client):
    response = client.post("/rooms", json={"code": "MT2", "capacity": 48})

    assert response.status_code == 201
    body = response.json()
    assert body["has_projector"] is False
    assert body["has_computers"] is False
    assert body["is_lab"] is False


def test_room_code_is_trimmed(client):
    room = create_room(client, code="  MT5bis  ")

    assert room["code"] == "MT5bis"


@pytest.mark.parametrize("code", ["", "   "])
def test_blank_room_code_is_rejected(client, code):
    response = client.post("/rooms", json={**LECTURE_HALL, "code": code})

    assert response.status_code == 422


def test_overlong_room_code_is_rejected(client):
    response = client.post("/rooms", json={**LECTURE_HALL, "code": "X" * 256})

    assert response.status_code == 422


def test_missing_capacity_is_rejected(client):
    response = client.post("/rooms", json={"code": "MT2"})

    assert response.status_code == 422


# --- Capacity validation ------------------------------------------------------


@pytest.mark.parametrize(
    ("capacity", "message"),
    [
        (0, "Capacity must be greater than zero."),
        (-5, "Capacity must be greater than zero."),
        ("0", "Capacity must be greater than zero."),
        ("-12", "Capacity must be greater than zero."),
        ("abc", "Capacity must be a whole number."),
        ("", "Capacity must be a whole number."),
        ("12 seats", "Capacity must be a whole number."),
        (12.5, "Capacity must be a whole number."),
        (True, "Capacity must be a whole number."),
        (None, "Capacity must be a whole number."),
        ([40], "Capacity must be a whole number."),
    ],
)
def test_invalid_capacity_is_rejected_with_clear_message(client, capacity, message):
    response = client.post("/rooms", json={**LECTURE_HALL, "capacity": capacity})

    assert response.status_code == 422
    assert message in error_text(response)
    assert client.get("/rooms").json() == []


@pytest.mark.parametrize(("capacity", "stored"), [(1, 1), ("40", 40), (" 40 ", 40), (60.0, 60)])
def test_numeric_capacity_is_accepted(client, capacity, stored):
    room = create_room(client, capacity=capacity)

    assert room["capacity"] == stored


# --- Duplicates ---------------------------------------------------------------


def test_duplicate_room_code_is_rejected(client):
    create_room(client)

    response = client.post("/rooms", json={**LECTURE_HALL, "capacity": 20})

    assert response.status_code == 409
    assert response.json()["detail"] == "A room with this code already exists."
    assert len(client.get("/rooms").json()) == 1


@pytest.mark.parametrize("code", ["mt1", " MT1 ", "Mt1"])
def test_duplicate_detection_ignores_case_and_spacing(client, code):
    create_room(client)

    response = client.post("/rooms", json={**LECTURE_HALL, "code": code})

    assert response.status_code == 409


# --- List and filter ----------------------------------------------------------


def test_list_is_empty_initially(client):
    response = client.get("/rooms")

    assert response.status_code == 200
    assert response.json() == []


def test_list_shows_code_capacity_and_features_sorted_by_code(client):
    for room in (SEMINAR_ROOM, PC_LAB, LECTURE_HALL):
        create_room(client, **room)

    rooms = client.get("/rooms").json()

    assert [room["code"] for room in rooms] == ["LAB-A", "MT1", "MT8"]
    lab = rooms[0]
    assert lab["capacity"] == 30
    assert lab["has_projector"] is True
    assert lab["has_computers"] is True
    assert lab["is_lab"] is True


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("is_lab=true", ["LAB-A"]),
        ("is_lab=false", ["MT1", "MT8"]),
        ("has_projector=true", ["LAB-A", "MT1"]),
        ("has_computers=true", ["LAB-A"]),
        ("has_projector=true&is_lab=false", ["MT1"]),
        ("has_projector=false&has_computers=true", []),
    ],
)
def test_list_filters_by_feature(client, query, expected):
    for room in (SEMINAR_ROOM, PC_LAB, LECTURE_HALL):
        create_room(client, **room)

    rooms = client.get(f"/rooms?{query}").json()

    assert [room["code"] for room in rooms] == expected


def test_invalid_filter_value_is_rejected(client):
    response = client.get("/rooms?is_lab=maybe")

    assert response.status_code == 422


def test_list_counts_scheduled_sessions(client, course):
    used = create_room(client)
    create_room(client, **SEMINAR_ROOM)
    schedule(client, course.id, used["id"])
    schedule(client, course.id, used["id"])

    counts = {room["code"]: room["scheduled_sessions"] for room in client.get("/rooms").json()}

    assert counts == {"MT1": 2, "MT8": 0}


def test_get_room(client, course):
    room = create_room(client)
    schedule(client, course.id, room["id"])

    response = client.get(f"/rooms/{room['id']}")

    assert response.status_code == 200
    assert response.json() == {**room, "scheduled_sessions": 1}


def test_get_missing_room_returns_404(client):
    response = client.get("/rooms/999")

    assert response.status_code == 404
    assert response.json()["detail"] == "Room not found."


# --- Update -------------------------------------------------------------------


def test_update_changes_every_field(client):
    room = create_room(client)

    response = client.put(f"/rooms/{room['id']}", json=PC_LAB)

    assert response.status_code == 200
    assert response.json() == {"id": room["id"], **PC_LAB, "scheduled_sessions": 0}
    assert client.get(f"/rooms/{room['id']}").json()["code"] == "LAB-A"


def test_update_can_keep_the_same_code(client):
    room = create_room(client)

    response = client.put(f"/rooms/{room['id']}", json={**LECTURE_HALL, "capacity": 120})

    assert response.status_code == 200
    assert response.json()["capacity"] == 120


def test_update_can_change_the_case_of_its_own_code(client):
    room = create_room(client)

    response = client.put(f"/rooms/{room['id']}", json={**LECTURE_HALL, "code": "mt1"})

    assert response.status_code == 200
    assert response.json()["code"] == "mt1"


def test_update_to_another_rooms_code_is_rejected(client):
    create_room(client)
    other = create_room(client, **SEMINAR_ROOM)

    response = client.put(f"/rooms/{other['id']}", json={**SEMINAR_ROOM, "code": "mt1"})

    assert response.status_code == 409
    assert client.get(f"/rooms/{other['id']}").json()["code"] == "MT8"


@pytest.mark.parametrize(
    ("capacity", "message"),
    [
        (0, "Capacity must be greater than zero."),
        (-1, "Capacity must be greater than zero."),
        ("lots", "Capacity must be a whole number."),
    ],
)
def test_update_validates_capacity_like_create(client, capacity, message):
    room = create_room(client)

    response = client.put(f"/rooms/{room['id']}", json={**LECTURE_HALL, "capacity": capacity})

    assert response.status_code == 422
    assert message in error_text(response)
    assert client.get(f"/rooms/{room['id']}").json()["capacity"] == 110


def test_update_rejects_blank_code(client):
    room = create_room(client)

    response = client.put(f"/rooms/{room['id']}", json={**LECTURE_HALL, "code": " "})

    assert response.status_code == 422


def test_update_missing_room_returns_404(client):
    response = client.put("/rooms/999", json=LECTURE_HALL)

    assert response.status_code == 404


def test_update_keeps_scheduled_sessions(client, course):
    room = create_room(client)
    schedule(client, course.id, room["id"])

    response = client.put(f"/rooms/{room['id']}", json={**LECTURE_HALL, "capacity": 90})

    assert response.json()["scheduled_sessions"] == 1


# --- Delete -------------------------------------------------------------------


def test_delete_unused_room(client):
    room = create_room(client)

    response = client.delete(f"/rooms/{room['id']}")

    assert response.status_code == 204
    assert client.get(f"/rooms/{room['id']}").status_code == 404
    assert client.get("/rooms").json() == []


def test_delete_missing_room_returns_404(client):
    response = client.delete("/rooms/999")

    assert response.status_code == 404


def test_delete_room_used_by_timetable_warns_first(client, course):
    room = create_room(client)
    schedule(client, course.id, room["id"])
    schedule(client, course.id, room["id"])

    response = client.delete(f"/rooms/{room['id']}")

    assert response.status_code == 409
    assert "used by 2 scheduled class(es)" in response.json()["detail"]
    assert client.get(f"/rooms/{room['id']}").status_code == 200


def test_confirmed_delete_removes_room_and_keeps_sessions_unassigned(client, session, course):
    room = create_room(client)
    scheduled = schedule(client, course.id, room["id"])

    response = client.delete(f"/rooms/{room['id']}?force=true")

    assert response.status_code == 204
    assert client.get(f"/rooms/{room['id']}").status_code == 404
    sessions = client.get("/timetable/sessions").json()
    assert [(item["id"], item["room_id"]) for item in sessions] == [(scheduled["id"], None)]
    assert session.get(ScheduleSession, scheduled["id"]).room_id is None


def test_confirmed_delete_leaves_other_rooms_sessions_alone(client, course):
    deleted = create_room(client)
    kept = create_room(client, **SEMINAR_ROOM)
    schedule(client, course.id, deleted["id"])
    schedule(client, course.id, kept["id"])

    client.delete(f"/rooms/{deleted['id']}?force=true")

    room_ids = sorted(
        (item["room_id"] for item in client.get("/timetable/sessions").json()),
        key=lambda room_id: room_id or 0,
    )
    assert room_ids == [None, kept["id"]]


def test_deleted_code_can_be_reused(client):
    room = create_room(client)
    client.delete(f"/rooms/{room['id']}")

    response = client.post("/rooms", json=LECTURE_HALL)

    assert response.status_code == 201


# --- Compatibility with the timetable -----------------------------------------


def test_rooms_list_still_serves_the_calendar(client):
    room = create_room(client)

    entry = client.get("/rooms").json()[0]

    assert entry["id"] == room["id"]
    assert entry["code"] == "MT1"


def test_timetable_session_rejects_unknown_room(client, course):
    response = client.post(
        "/timetable/sessions",
        json={
            "course_id": course.id,
            "room_id": 999,
            "weekday": 0,
            "start_time": "09:00",
            "end_time": "11:00",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Room not found."
