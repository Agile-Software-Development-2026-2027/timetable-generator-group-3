"""KAN-69: the account ↔ teacher/student link in the database and in endpoints."""

import uuid
from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_student, get_current_teacher
from app.config import get_settings
from app.database import get_session
from app.models import AppUser, Enrollment, Student, Teacher
from tests.conftest import TEST_SETTINGS


@pytest.fixture()
def teacher(session):
    record = Teacher(name="Ada Lovelace", identifier="T001")
    session.add(record)
    session.commit()
    return record


@pytest.fixture()
def student(session, course):
    record = Student(name="Grace Hopper", student_number="M100", degree_id=course.degree_id, year_id=course.year_id)
    session.add(record)
    session.commit()
    return record


# --- Database rules ---------------------------------------------------------

@pytest.mark.parametrize("role,link", [
    ("teacher", {}),
    ("student", {}),
    ("director", {"teacher_id": "teacher"}),
    ("director", {"student_id": "student"}),
    ("teacher", {"student_id": "student"}),
    ("student", {"teacher_id": "teacher"}),
    ("teacher", {"teacher_id": "teacher", "student_id": "student"}),
])
def test_link_must_match_the_role(session, teacher, student, role, link):
    records = {"teacher": teacher.id, "student": student.id}
    session.add(AppUser(id=uuid.uuid4(), role=role, **{field: records[name] for field, name in link.items()}))

    with pytest.raises(IntegrityError):
        session.commit()


@pytest.mark.parametrize("role,field,record", [("teacher", "teacher_id", "teacher"), ("student", "student_id", "student")])
def test_a_record_can_be_linked_to_one_account_only(session, request, role, field, record):
    record_id = request.getfixturevalue(record).id
    session.add(AppUser(id=uuid.uuid4(), role=role, **{field: record_id}))
    session.commit()

    session.add(AppUser(id=uuid.uuid4(), role=role, **{field: record_id}))
    with pytest.raises(IntegrityError):
        session.commit()


def test_deleting_the_teacher_removes_the_accounts_role(auth_client, session, teacher):
    auth_client("teacher", teacher=teacher)
    director = auth_client("director")

    assert director.delete(f"/teachers/{teacher.id}").status_code == 204
    session.expire_all()
    assert session.query(AppUser).filter_by(role="teacher").count() == 0


def test_deleting_the_student_removes_the_accounts_role(auth_client, session, student):
    auth_client("student", student=student)
    director = auth_client("director")

    assert director.delete(f"/students/{student.id}").status_code == 204
    session.expire_all()
    assert session.query(AppUser).filter_by(role="student").count() == 0


# --- get_current_student / get_current_teacher -------------------------------
# A tiny app with the same shape as KAN-58/KAN-59 endpoints, so the dependencies
# are tested the way those endpoints will use them.

probe = FastAPI()


@probe.get("/students/me")
def my_student(
    me: Annotated[Student, Depends(get_current_student)],
    session: Annotated[Session, Depends(get_session)],
):
    # Same request session: the student can be used in queries and writes.
    assert me in session
    return {"id": me.id, "enrollments": session.query(Enrollment).filter_by(student_id=me.id).count()}


@probe.get("/teachers/me")
def my_teacher(me: Annotated[Teacher, Depends(get_current_teacher)]):
    return {"id": me.id, "name": me.name}


@pytest.fixture()
def probe_client(session_factory):
    def override_get_session():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    probe.dependency_overrides[get_session] = override_get_session
    probe.dependency_overrides[get_settings] = lambda: TEST_SETTINGS
    yield lambda token=None: TestClient(probe, headers={"Authorization": f"Bearer {token}"} if token else {})
    probe.dependency_overrides.clear()


def account(session, role, **link):
    user = AppUser(id=uuid.uuid4(), role=role, **link)
    session.add(user)
    session.commit()
    return user


def test_current_student_is_the_linked_profile(probe_client, session, make_token, student):
    user = account(session, "student", student_id=student.id)

    response = probe_client(make_token(user.id)).get("/students/me")

    assert response.status_code == 200
    assert response.json() == {"id": student.id, "enrollments": 0}


def test_current_teacher_is_the_linked_record(probe_client, session, make_token, teacher):
    user = account(session, "teacher", teacher_id=teacher.id)

    response = probe_client(make_token(user.id)).get("/teachers/me")

    assert response.json() == {"id": teacher.id, "name": "Ada Lovelace"}


@pytest.mark.parametrize("path,role,detail", [
    ("/students/me", "teacher", "Only students can use this."),
    ("/students/me", "director", "Only students can use this."),
    ("/teachers/me", "student", "Only teachers can use this."),
    ("/teachers/me", "director", "Only teachers can use this."),
])
def test_other_roles_get_403(probe_client, session, make_token, teacher, student, path, role, detail):
    link = {"teacher": {"teacher_id": teacher.id}, "student": {"student_id": student.id}}.get(role, {})
    user = account(session, role, **link)

    response = probe_client(make_token(user.id)).get(path)

    assert response.status_code == 403
    assert response.json()["detail"] == detail


@pytest.mark.parametrize("path", ["/students/me", "/teachers/me"])
def test_anonymous_users_get_401(probe_client, path):
    assert probe_client().get(path).status_code == 401
