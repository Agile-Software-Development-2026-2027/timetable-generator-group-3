from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.models import SlotConfig
from app.seed.seed_sample_data import validate, validate_course_grid


@pytest.fixture
def dataset():
    return {
        "degree": {"name": "Computer Science"},
        "years": [
            {"number": 1, "semesters": [1]}
        ],
        "rooms": [],
        "teachers": [
            {"name": "Test Teacher", "identifier": "T001"}
        ],
        "courses": [
            {
                "name": "Software Engineering",
                "year": 1,
                "semester": 1,
                "weekly_hours": 6,
                "enrolled_students": 30,
                "requires_lab": False,
                "teacher_ids": ["T001"],
            }
        ],
    }


class FakeSession:
    def __init__(self, block_minutes=30):
        self.block_minutes = block_minutes

    def get(self, model, identifier):
        assert model is SlotConfig
        assert identifier == 1
        if self.block_minutes is None:
            return None
        return SimpleNamespace(block_minutes=self.block_minutes)


def test_missing_duration_defaults_to_60(dataset):
    validate(dataset)
    validate_course_grid(FakeSession(30), dataset)

    course = dataset["courses"][0]
    assert course.get("session_duration_minutes", 60) == 60


@pytest.mark.parametrize("duration", [60, 90, 120, 180, 360])
def test_valid_session_durations(dataset, duration):
    data = deepcopy(dataset)
    data["courses"][0]["session_duration_minutes"] = duration

    validate(data)
    validate_course_grid(FakeSession(30), data)


@pytest.mark.parametrize("duration", [0, -30, 100, 12.5, True])
def test_invalid_session_durations(dataset, duration):
    data = deepcopy(dataset)
    data["courses"][0]["session_duration_minutes"] = duration

    with pytest.raises(ValueError):
        validate(data)


def test_duration_incompatible_with_grid(dataset):
    dataset["courses"][0]["session_duration_minutes"] = 45

    validate(dataset)

    with pytest.raises(ValueError, match="grid block"):
        validate_course_grid(FakeSession(30), dataset)


def test_duration_with_custom_grid(dataset):
    dataset["courses"][0]["session_duration_minutes"] = 90

    validate(dataset)
    validate_course_grid(FakeSession(45), dataset)

    with pytest.raises(ValueError, match="grid block"):
        validate_course_grid(FakeSession(60), dataset)


def test_missing_grid_config_uses_default_30(dataset):
    dataset["courses"][0]["session_duration_minutes"] = 90

    validate(dataset)
    validate_course_grid(FakeSession(None), dataset)
from app import seed_api


@pytest.fixture
def seed_api_client(client, auth_client, session_factory, engine, monkeypatch):
    # Both endpoints use the isolated SQLite test database.
    monkeypatch.setattr(seed_api, "SessionLocal", session_factory)
    monkeypatch.setattr(seed_api, "engine", engine)
    return auth_client("director")


def test_seed_preview_accepts_90_minutes(seed_api_client, dataset):
    dataset["courses"][0]["session_duration_minutes"] = 90

    response = seed_api_client.post("/seed/validate", json=dataset)

    assert response.status_code == 200
    assert response.json()["valid"] is True


def test_seed_preview_rejects_grid_mismatch(seed_api_client, dataset):
    dataset["courses"][0]["session_duration_minutes"] = 45

    response = seed_api_client.post("/seed/validate", json=dataset)

    assert response.status_code == 422
    assert "grid block" in response.json()["detail"]


def test_seed_import_rejects_grid_mismatch(seed_api_client, dataset):
    dataset["courses"][0]["session_duration_minutes"] = 45

    response = seed_api_client.post("/seed/import", json=dataset)

    assert response.status_code == 422
    assert "grid block" in response.json()["detail"]


def test_seed_import_saves_custom_duration(
    seed_api_client, dataset, session_factory
):
    from sqlalchemy import select
    from app.models import Course

    dataset["courses"][0]["session_duration_minutes"] = 90

    response = seed_api_client.post("/seed/import", json=dataset)

    assert response.status_code == 200

    with session_factory() as session:
        course = session.scalar(
            select(Course).where(Course.name == "Software Engineering")
        )
        assert course is not None
        assert course.session_duration_minutes == 90


def test_seed_import_defaults_to_60_minutes(
    seed_api_client, dataset, session_factory
):
    from sqlalchemy import select
    from app.models import Course

    response = seed_api_client.post("/seed/import", json=dataset)

    assert response.status_code == 200

    with session_factory() as session:
        course = session.scalar(
            select(Course).where(Course.name == "Software Engineering")
        )
        assert course is not None
        assert course.session_duration_minutes == 60
