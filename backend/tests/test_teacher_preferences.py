"""KAN-72: teacher workload preferences API and database integrity."""

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Teacher, TeacherPreferences


EMPTY = {
    "max_hours_per_day": None,
    "max_teaching_days": None,
    "max_consecutive_hours": None,
    "preferred_part_of_day": None,
}

VALID = {
    "max_hours_per_day": 4,
    "max_teaching_days": 3,
    "max_consecutive_hours": 2,
    "preferred_part_of_day": "morning",
}


@pytest.fixture()
def teacher(session):
    record = Teacher(name="Mario Rossi", identifier="WORKLOAD-1")
    session.add(record)
    session.commit()
    return record


@pytest.fixture()
def director(auth_client):
    return auth_client("director")


def url(teacher_id):
    return f"/teachers/{teacher_id}/preferences"


def test_new_teacher_has_no_preferences(director, teacher, session):
    response = director.get(url(teacher.id))

    assert response.status_code == 200
    assert response.json() == EMPTY
    assert session.query(TeacherPreferences).count() == 0


def test_create_and_read_preferences(director, teacher, session):
    response = director.put(url(teacher.id), json=VALID)

    assert response.status_code == 200
    assert response.json() == VALID
    assert director.get(url(teacher.id)).json() == VALID

    session.expire_all()
    saved = session.get(TeacherPreferences, teacher.id)
    assert saved.max_hours_per_day == 4
    assert saved.max_teaching_days == 3
    assert saved.max_consecutive_hours == 2
    assert saved.preferred_part_of_day == "morning"


def test_update_does_not_create_duplicate_rows(director, teacher, session):
    assert director.put(url(teacher.id), json=VALID).status_code == 200

    updated = {
        **VALID,
        "max_hours_per_day": 6,
        "preferred_part_of_day": "afternoon",
    }

    response = director.put(url(teacher.id), json=updated)

    assert response.status_code == 200
    assert response.json() == updated
    assert director.get(url(teacher.id)).json() == updated
    assert session.query(TeacherPreferences).count() == 1


def test_null_values_clear_preferences(director, teacher):
    assert director.put(url(teacher.id), json=VALID).status_code == 200

    response = director.put(url(teacher.id), json=EMPTY)

    assert response.status_code == 200
    assert response.json() == EMPTY
    assert director.get(url(teacher.id)).json() == EMPTY


def test_put_replaces_omitted_fields(director, teacher):
    assert director.put(url(teacher.id), json=VALID).status_code == 200

    response = director.put(
        url(teacher.id), json={"max_hours_per_day": 5}
    )

    assert response.status_code == 200
    assert response.json() == {**EMPTY, "max_hours_per_day": 5}


@pytest.mark.parametrize("preference", ["morning", "afternoon", "none", None])
def test_valid_part_of_day(director, teacher, preference):
    response = director.put(
        url(teacher.id),
        json={"preferred_part_of_day": preference},
    )

    assert response.status_code == 200
    assert response.json()["preferred_part_of_day"] == preference


@pytest.mark.parametrize("field", [
    "max_hours_per_day",
    "max_teaching_days",
    "max_consecutive_hours",
])
@pytest.mark.parametrize("value", [0, -1, 1.5, True, "2"])
def test_invalid_numeric_values(director, teacher, field, value):
    response = director.put(url(teacher.id), json={field: value})

    assert response.status_code == 422


@pytest.mark.parametrize("value", ["evening", "Morning", ""])
def test_invalid_part_of_day(director, teacher, value):
    response = director.put(
        url(teacher.id),
        json={"preferred_part_of_day": value},
    )

    assert response.status_code == 422


def test_teaching_days_cannot_exceed_six(director, teacher):
    response = director.put(
        url(teacher.id), json={"max_teaching_days": 7}
    )

    assert response.status_code == 422


def test_teaching_days_follow_current_grid(director, teacher):
    config = {
        "working_days": [0, 2, 4],
        "start_time": "09:00:00",
        "end_time": "18:00:00",
        "block_minutes": 30,
    }

    assert director.put("/slot-config", json=config).status_code == 200

    response = director.put(
        url(teacher.id), json={"max_teaching_days": 4}
    )

    assert response.status_code == 422
    assert "working days (3)" in response.json()["detail"]

    response = director.put(
        url(teacher.id), json={"max_teaching_days": 3}
    )

    assert response.status_code == 200


def test_six_teaching_days_allowed_on_six_day_grid(director, teacher):
    config = {
        "working_days": [0, 1, 2, 3, 4, 5],
        "start_time": "09:00:00",
        "end_time": "18:00:00",
        "block_minutes": 30,
    }

    assert director.put("/slot-config", json=config).status_code == 200

    response = director.put(
        url(teacher.id), json={"max_teaching_days": 6}
    )

    assert response.status_code == 200
    assert response.json()["max_teaching_days"] == 6


def test_rejected_update_preserves_preferences(director, teacher):
    assert director.put(url(teacher.id), json=VALID).status_code == 200

    response = director.put(
        url(teacher.id), json={**VALID, "max_teaching_days": 6}
    )

    assert response.status_code == 422
    assert director.get(url(teacher.id)).json() == VALID


def test_unknown_teacher_returns_404(director):
    assert director.get(url(999)).status_code == 404
    assert director.put(url(999), json=VALID).status_code == 404


def test_teacher_can_read_and_write_own_preferences(auth_client, teacher):
    api = auth_client("teacher", teacher=teacher)

    assert api.put(url(teacher.id), json=VALID).status_code == 200
    assert api.get(url(teacher.id)).json() == VALID


def test_teacher_cannot_access_another_teacher(auth_client, session, teacher):
    other = Teacher(name="Anna Bianchi", identifier="WORKLOAD-2")
    session.add(other)
    session.commit()

    api = auth_client("teacher", teacher=other)

    assert api.get(url(teacher.id)).status_code == 403
    assert api.put(url(teacher.id), json=VALID).status_code == 403


def test_students_cannot_access_preferences(auth_client, teacher):
    api = auth_client("student")

    assert api.get(url(teacher.id)).status_code == 403
    assert api.put(url(teacher.id), json=VALID).status_code == 403


def test_preferences_require_authentication(client, teacher):
    assert client.get(url(teacher.id)).status_code == 401
    assert client.put(url(teacher.id), json=VALID).status_code == 401


def test_preferences_are_isolated_by_teacher(director, session, teacher):
    other = Teacher(name="Anna Bianchi", identifier="WORKLOAD-2")
    session.add(other)
    session.commit()

    assert director.put(url(teacher.id), json=VALID).status_code == 200

    assert director.get(url(other.id)).json() == EMPTY

    response = director.put(
        url(other.id), json={"max_hours_per_day": 2}
    )

    assert response.status_code == 200
    assert director.get(url(teacher.id)).json() == VALID


def test_deleting_teacher_cascades_preferences(director, client, teacher, session):
    assert director.put(url(teacher.id), json=VALID).status_code == 200

    assert client.delete(f"/teachers/{teacher.id}").status_code == 204

    session.expire_all()
    assert session.query(TeacherPreferences).count() == 0


@pytest.mark.parametrize("invalid", [
    {"max_hours_per_day": 0},
    {"max_teaching_days": 0},
    {"max_teaching_days": 7},
    {"max_consecutive_hours": -1},
    {"preferred_part_of_day": "evening"},
])
def test_database_rejects_invalid_preferences(session, teacher, invalid):
    session.add(
        TeacherPreferences(teacher_id=teacher.id, **invalid)
    )

    with pytest.raises(IntegrityError):
        session.commit()

    session.rollback()


def test_database_rejects_duplicate_preferences(session, teacher):
    teacher_id = teacher.id
    session.add(TeacherPreferences(teacher_id=teacher_id))
    session.commit()
    session.expunge_all()

    session.add(TeacherPreferences(teacher_id=teacher_id))

    with pytest.raises(IntegrityError):
        session.commit()

    session.rollback()


def test_database_rejects_unknown_teacher(session):
    session.add(TeacherPreferences(teacher_id=999))

    with pytest.raises(IntegrityError):
        session.commit()

    session.rollback()
