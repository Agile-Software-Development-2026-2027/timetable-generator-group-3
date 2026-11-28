"""KAN-57: teacher availability API."""
import pytest

from app.models import Teacher, TeacherAvailability

MONDAY_MORNING = {"weekday": 0, "start_time": "09:00:00", "end_time": "12:00:00",
                  "availability_type": "unavailable"}
FRIDAY_AFTERNOON = {"weekday": 4, "start_time": "14:00:00", "end_time": "16:00:00",
                    "availability_type": "preferred"}


@pytest.fixture()
def teacher(session):
    teacher = Teacher(name="Mario Rossi", identifier="STAFF-1")
    session.add(teacher)
    session.commit()
    return teacher


@pytest.fixture()
def director(auth_client):
    return auth_client("director")


def put(api, teacher_id, entries):
    return api.put(f"/teachers/{teacher_id}/availability", json=entries)


def test_new_teacher_has_no_entries(director, teacher):
    response = director.get(f"/teachers/{teacher.id}/availability")

    assert response.status_code == 200
    assert response.json() == []


def test_put_replaces_and_get_reads_entries_in_order(director, teacher):
    put(director, teacher.id, [MONDAY_MORNING])

    response = put(director, teacher.id, [FRIDAY_AFTERNOON, MONDAY_MORNING])

    assert response.status_code == 200
    body = director.get(f"/teachers/{teacher.id}/availability").json()
    assert body == response.json()
    assert [{k: v for k, v in e.items() if k != "id"} for e in body] == [
        MONDAY_MORNING, FRIDAY_AFTERNOON,
    ]


def test_put_with_empty_list_clears_entries(director, teacher):
    put(director, teacher.id, [MONDAY_MORNING])

    assert put(director, teacher.id, []).json() == []


def test_same_type_overlaps_are_allowed(director, teacher):
    other = {**MONDAY_MORNING, "start_time": "11:00:00", "end_time": "13:00:00"}

    assert put(director, teacher.id, [MONDAY_MORNING, other]).status_code == 200


@pytest.mark.parametrize(("change", "message"), [
    ({"weekday": 5}, "Entry 1: Saturday is not a working day."),
    ({"start_time": "08:00:00"}, "Entry 1: times must be within the working day (09:00–18:00)."),
    ({"end_time": "19:00:00"}, "Entry 1: times must be within the working day (09:00–18:00)."),
])
def test_entries_outside_the_slot_config_are_rejected(director, teacher, change, message):
    response = put(director, teacher.id, [{**MONDAY_MORNING, **change}])

    assert response.status_code == 422
    assert response.json()["detail"] == message


def test_working_days_follow_the_slot_config(director, teacher):
    director.put("/slot-config", json={"working_days": [0, 5], "start_time": "08:00:00",
                                     "end_time": "18:00:00", "block_minutes": 60})

    saturday = {**MONDAY_MORNING, "weekday": 5, "start_time": "08:00:00"}
    assert put(director, teacher.id, [saturday]).status_code == 200
    assert put(director, teacher.id, [{**MONDAY_MORNING, "weekday": 1}]).status_code == 422


def test_overlapping_entries_of_different_types_are_rejected(director, teacher, session):
    put(director, teacher.id, [FRIDAY_AFTERNOON])
    preferred = {**MONDAY_MORNING, "availability_type": "preferred",
                 "start_time": "11:00:00", "end_time": "13:00:00"}

    response = put(director, teacher.id, [MONDAY_MORNING, preferred])

    assert response.status_code == 422
    assert "Entries 1 and 2 overlap on Monday" in response.json()["detail"]
    # A rejected PUT keeps the previous entries.
    assert [e["weekday"] for e in director.get(f"/teachers/{teacher.id}/availability").json()] == [4]


def test_touching_ranges_of_different_types_do_not_overlap(director, teacher):
    preferred = {**MONDAY_MORNING, "availability_type": "preferred",
                 "start_time": "12:00:00", "end_time": "13:00:00"}

    assert put(director, teacher.id, [MONDAY_MORNING, preferred]).status_code == 200


@pytest.mark.parametrize("change", [
    {"start_time": "12:00:00", "end_time": "12:00:00"},
    {"start_time": "12:00:00", "end_time": "10:00:00"},
    {"weekday": 7},
    {"availability_type": "busy"},
])
def test_invalid_entries_are_rejected(director, teacher, change):
    assert put(director, teacher.id, [{**MONDAY_MORNING, **change}]).status_code == 422


def test_unknown_teacher_returns_404(director):
    assert director.get("/teachers/999/availability").status_code == 404
    assert put(director, 999, [MONDAY_MORNING]).status_code == 404


def test_deleting_a_teacher_deletes_their_entries(director, client, teacher, session):
    put(director, teacher.id, [MONDAY_MORNING])

    assert director.delete(f"/teachers/{teacher.id}").status_code == 204
    session.expire_all()
    assert session.query(TeacherAvailability).count() == 0


def test_teacher_id_is_indexed(engine):
    from sqlalchemy import inspect

    indexes = inspect(engine).get_indexes("teacher_availability")
    assert {"name": "ix_teacher_availability_teacher_id", "column_names": ["teacher_id"]} in [
        {"name": i["name"], "column_names": i["column_names"]} for i in indexes
    ]


# --- Permissions (KAN-57 + KAN-69 account links) -------------------------------


def test_a_teacher_can_read_and_write_their_own_record(auth_client, teacher):
    api = auth_client("teacher", teacher=teacher)

    assert put(api, teacher.id, [MONDAY_MORNING]).status_code == 200
    assert len(api.get(f"/teachers/{teacher.id}/availability").json()) == 1


def test_a_teacher_cannot_use_another_teachers_record(auth_client, session, teacher):
    other = Teacher(name="Anna Bianchi", identifier="STAFF-2")
    session.add(other)
    session.commit()
    api = auth_client("teacher", teacher=other)

    assert api.get(f"/teachers/{teacher.id}/availability").status_code == 403
    response = put(api, teacher.id, [MONDAY_MORNING])
    assert response.status_code == 403
    assert response.json()["detail"] == "You can only read or change your own availability."


def test_students_cannot_use_availability(auth_client, teacher):
    api = auth_client("student")

    assert api.get(f"/teachers/{teacher.id}/availability").status_code == 403
    assert put(api, teacher.id, []).status_code == 403


def test_availability_requires_sign_in(client, teacher):
    assert client.get(f"/teachers/{teacher.id}/availability").status_code == 401
    assert put(client, teacher.id, []).status_code == 401
