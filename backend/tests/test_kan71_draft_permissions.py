"""KAN-71: draft-writing endpoints must never be public."""
import pytest


PAYLOAD = {"course_id": 9999, "room_id": None, "weekday": 0,
           "start_time": "09:00", "end_time": "10:00"}

CASES = [
    ("post", "/timetable/sessions", PAYLOAD),
    ("put", "/timetable/sessions/9999", PAYLOAD),
    ("delete", "/timetable/sessions?degree_id=9999", None),
    ("delete", "/timetable/sessions/9999", None),
    ("post", "/timetable/generate", {"degree_id": 9999}),
]


@pytest.mark.parametrize("method,path,payload", CASES)
def test_unauthenticated_cannot_modify_draft(client, method, path, payload):
    response = getattr(client, method)(path, **({"json": payload} if payload else {}))
    assert response.status_code == 401, response.text


@pytest.mark.parametrize("role", ["teacher", "student"])
@pytest.mark.parametrize("method,path,payload", CASES)
def test_non_director_cannot_modify_draft(auth_client, role, method, path, payload):
    client = auth_client(role)
    response = getattr(client, method)(path, **({"json": payload} if payload else {}))
    assert response.status_code == 403, response.text


@pytest.mark.parametrize("method,path,payload", CASES)
def test_director_passes_authorization(auth_client, method, path, payload):
    client = auth_client("director")
    response = getattr(client, method)(path, **({"json": payload} if payload else {}))
    assert response.status_code == 404, response.text
