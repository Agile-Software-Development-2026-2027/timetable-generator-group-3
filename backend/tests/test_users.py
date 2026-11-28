"""KAN-69: directors invite accounts and link them to a teacher or student."""

import dataclasses
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.main import app
from app.models import AppUser, Student, Teacher, TimetablePublication, director_degree
from app.supabase_admin import AdminError, AuthAccount, get_supabase_admin
from tests.conftest import TEST_SETTINGS


class FakeAdmin:
    """Stands in for Supabase: remembers accounts, invites and bans."""

    def __init__(self):
        self.accounts: dict[uuid.UUID, AuthAccount] = {}
        self.invites: list[tuple[str, str]] = []
        self.deleted: list[uuid.UUID] = []
        self.fail: AdminError | None = None

    def _check(self):
        if self.fail:
            raise self.fail

    def add(self, user_id, email, *, confirmed=True, banned=False):
        self.accounts[user_id] = AuthAccount(user_id, email, confirmed, banned)

    def invite_user(self, email, redirect_to):
        self._check()
        if any(account.email == email for account in self.accounts.values()):
            raise AdminError(422, "A user with this email address has already been registered", "email_exists")
        account = AuthAccount(uuid.uuid4(), email, confirmed=False, banned=False)
        self.accounts[account.id] = account
        self.invites.append((email, redirect_to))
        return account

    def list_users(self):
        self._check()
        return list(self.accounts.values())

    def get_user(self, user_id):
        self._check()
        if user_id not in self.accounts:
            raise AdminError(404, "User not found")
        return self.accounts[user_id]

    def ban_user(self, user_id):
        self._check()
        if user_id not in self.accounts:
            raise AdminError(404, "User not found")
        self.accounts[user_id] = dataclasses.replace(self.accounts[user_id], banned=True)

    def delete_user(self, user_id):
        self.deleted.append(user_id)
        self.accounts.pop(user_id, None)


@pytest.fixture()
def admin(client):
    fake = FakeAdmin()
    app.dependency_overrides[get_supabase_admin] = lambda: fake
    return fake


def login(session, make_token, role="director", **link):
    user = AppUser(id=uuid.uuid4(), role=role, **link)
    session.add(user)
    session.commit()
    return TestClient(app, headers={"Authorization": f"Bearer {make_token(user.id)}"}), user


@pytest.fixture()
def director(client, session, make_token, admin):
    api, user = login(session, make_token)
    admin.add(user.id, "director@unical.it")
    api.user = user
    return api


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


def invite(api, **payload):
    return api.post("/users", json=payload)


def accounts(session):
    session.expire_all()
    return session.query(AppUser).filter(AppUser.role != "director").all()


# --- Invite -----------------------------------------------------------------

def test_invite_teacher_creates_the_linked_account(director, admin, session, teacher):
    response = invite(director, email="  Ada@Unical.it ", role="teacher", teacher_id=teacher.id)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body | {"id": None, "created_at": None} == {
        "id": None, "created_at": None, "email": "ada@unical.it", "role": "teacher",
        "teacher_id": teacher.id, "student_id": None, "linked_name": "Ada Lovelace", "status": "invited",
    }
    assert admin.invites == [("ada@unical.it", TEST_SETTINGS.invite_redirect_url)]
    [row] = accounts(session)
    assert (str(row.id), row.role, row.teacher_id, row.student_id) == (body["id"], "teacher", teacher.id, None)


def test_invite_student_creates_the_linked_account(director, session, student):
    response = invite(director, email="grace@unical.it", role="student", student_id=student.id)

    assert response.status_code == 201, response.text
    assert response.json()["linked_name"] == "Grace Hopper (M100)"
    assert accounts(session)[0].student_id == student.id


def test_invite_director_has_no_link(director, session):
    response = invite(director, email="second.director@unical.it", role="director")

    assert response.status_code == 201, response.text
    assert response.json()["teacher_id"] is None
    assert response.json()["student_id"] is None


def test_invited_user_logs_in_and_me_returns_the_linked_id(director, client, make_token, teacher):
    user_id = invite(director, email="ada@unical.it", role="teacher", teacher_id=teacher.id).json()["id"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {make_token(user_id)}"})

    assert me.status_code == 200
    assert me.json() == {"id": user_id, "role": "teacher", "teacher_id": teacher.id}


def test_linking_a_teacher_twice_returns_409(director, admin, session, teacher):
    invite(director, email="ada@unical.it", role="teacher", teacher_id=teacher.id)

    response = invite(director, email="ada.other@unical.it", role="teacher", teacher_id=teacher.id)

    assert response.status_code == 409
    assert response.json()["detail"] == "This teacher is already linked to another account."
    assert len(admin.invites) == 1
    assert len(accounts(session)) == 1


def test_linking_a_student_twice_returns_409(director, admin, student):
    invite(director, email="grace@unical.it", role="student", student_id=student.id)

    response = invite(director, email="grace.other@unical.it", role="student", student_id=student.id)

    assert response.status_code == 409
    assert response.json()["detail"] == "This student is already linked to another account."
    assert len(admin.invites) == 1


@pytest.mark.parametrize("payload,detail", [
    ({"role": "teacher", "teacher_id": 999}, "Teacher not found."),
    ({"role": "student", "student_id": 999}, "Student not found."),
])
def test_unknown_record_returns_404(director, admin, session, payload, detail):
    response = invite(director, email="new@unical.it", **payload)

    assert response.status_code == 404
    assert response.json()["detail"] == detail
    assert admin.invites == []
    assert accounts(session) == []


@pytest.mark.parametrize("payload", [
    {"role": "teacher"},
    {"role": "student"},
    {"role": "director", "teacher_id": 1},
    {"role": "director", "student_id": 1},
    {"role": "teacher", "teacher_id": 1, "student_id": 1},
    {"role": "student", "student_id": 1, "teacher_id": 1},
])
def test_link_must_match_the_role(director, admin, teacher, student, payload):
    response = invite(director, email="new@unical.it", **payload)

    assert response.status_code == 422
    assert admin.invites == []


@pytest.mark.parametrize("payload", [
    {"email": "not-an-email", "role": "director"},
    {"email": "", "role": "director"},
    {"email": "new@unical.it", "role": "admin"},
    {"role": "director"},
])
def test_invalid_invite_returns_422(director, admin, payload):
    assert director.post("/users", json=payload).status_code == 422
    assert admin.invites == []


def test_existing_email_returns_409_without_creating_a_row(director, admin, session, teacher):
    admin.add(uuid.uuid4(), "ada@unical.it")

    response = invite(director, email="ada@unical.it", role="teacher", teacher_id=teacher.id)

    assert response.status_code == 409
    assert response.json()["detail"] == "An account with this email already exists."
    assert accounts(session) == []


def test_unreachable_supabase_returns_503_without_creating_a_row(director, admin, session, teacher):
    admin.fail = AdminError(503, "Could not reach Supabase. Try again in a moment.")

    response = invite(director, email="ada@unical.it", role="teacher", teacher_id=teacher.id)

    assert response.status_code == 503
    assert accounts(session) == []


# --- Access -----------------------------------------------------------------

ENDPOINTS = [
    ("get", "/users", None),
    ("post", "/users", {"email": "new@unical.it", "role": "director"}),
    ("patch", f"/users/{uuid.uuid4()}", {"role": "director"}),
    ("delete", f"/users/{uuid.uuid4()}", None),
]


@pytest.mark.parametrize("role", ["teacher", "student"])
@pytest.mark.parametrize("method,path,payload", ENDPOINTS)
def test_non_directors_get_403(auth_client, admin, role, method, path, payload):
    api = auth_client(role)

    response = getattr(api, method)(path, **({"json": payload} if payload else {}))

    assert response.status_code == 403
    assert admin.invites == []


@pytest.mark.parametrize("method,path,payload", ENDPOINTS)
def test_anonymous_users_get_401(client, method, path, payload):
    response = getattr(client, method)(path, **({"json": payload} if payload else {}))

    assert response.status_code == 401


def test_missing_service_role_key_returns_503(client, session, make_token):
    api, _user = login(session, make_token)

    response = api.get("/users")

    assert response.status_code == 503
    assert "SUPABASE_SERVICE_ROLE_KEY" in response.json()["detail"]


# --- List -------------------------------------------------------------------

def test_list_shows_email_role_link_and_status(director, admin, session, teacher, student):
    teacher_user = invite(director, email="ada@unical.it", role="teacher", teacher_id=teacher.id).json()
    student_user = invite(director, email="grace@unical.it", role="student", student_id=student.id).json()
    admin.add(uuid.UUID(student_user["id"]), "grace@unical.it", confirmed=True)

    response = director.get("/users")

    assert response.status_code == 200
    rows = [(row["email"], row["role"], row["linked_name"], row["status"]) for row in response.json()]
    assert rows == [
        ("ada@unical.it", "teacher", "Ada Lovelace", "invited"),
        ("director@unical.it", "director", None, "active"),
        ("grace@unical.it", "student", "Grace Hopper (M100)", "active"),
    ]
    assert teacher_user["id"] in {row["id"] for row in response.json()}


def test_list_shows_accounts_missing_from_supabase_without_email(director, admin, session):
    orphan = AppUser(id=uuid.uuid4(), role="director")
    session.add(orphan)
    session.commit()

    rows = director.get("/users").json()

    assert rows[-1]["id"] == str(orphan.id)
    assert (rows[-1]["email"], rows[-1]["status"]) == (None, None)


# --- Update -----------------------------------------------------------------

def test_patch_changes_the_linked_record(director, session, teacher):
    other = Teacher(name="Alan Turing", identifier="T002")
    session.add(other)
    session.commit()
    user_id = invite(director, email="ada@unical.it", role="teacher", teacher_id=teacher.id).json()["id"]

    response = director.patch(f"/users/{user_id}", json={"role": "teacher", "teacher_id": other.id})

    assert response.status_code == 200, response.text
    assert (response.json()["teacher_id"], response.json()["linked_name"]) == (other.id, "Alan Turing")
    assert response.json()["email"] == "ada@unical.it"


def test_patch_changes_the_role(director, session, teacher, student):
    user_id = invite(director, email="ada@unical.it", role="teacher", teacher_id=teacher.id).json()["id"]

    response = director.patch(f"/users/{user_id}", json={"role": "student", "student_id": student.id})

    assert response.status_code == 200, response.text
    assert (response.json()["role"], response.json()["teacher_id"], response.json()["student_id"]) == (
        "student", None, student.id)


def test_patch_to_a_record_linked_elsewhere_returns_409(director, session, teacher):
    other = Teacher(name="Alan Turing", identifier="T002")
    session.add(other)
    session.commit()
    invite(director, email="ada@unical.it", role="teacher", teacher_id=teacher.id)
    user_id = invite(director, email="alan@unical.it", role="teacher", teacher_id=other.id).json()["id"]

    response = director.patch(f"/users/{user_id}", json={"role": "teacher", "teacher_id": teacher.id})

    assert response.status_code == 409


def test_patch_keeping_the_same_link_is_allowed(director, teacher):
    user_id = invite(director, email="ada@unical.it", role="teacher", teacher_id=teacher.id).json()["id"]

    response = director.patch(f"/users/{user_id}", json={"role": "teacher", "teacher_id": teacher.id})

    assert response.status_code == 200


def test_patch_unknown_account_returns_404(director):
    assert director.patch(f"/users/{uuid.uuid4()}", json={"role": "director"}).status_code == 404


def test_director_cannot_change_their_own_role(director, teacher):
    response = director.patch(f"/users/{director.user.id}", json={"role": "teacher", "teacher_id": teacher.id})

    assert response.status_code == 409
    assert response.json()["detail"] == "You cannot change your own role."


# --- Deactivate -------------------------------------------------------------

def test_delete_bans_the_account_and_removes_its_role(director, admin, session, client, make_token, teacher):
    user_id = invite(director, email="ada@unical.it", role="teacher", teacher_id=teacher.id).json()["id"]

    response = director.delete(f"/users/{user_id}")

    assert response.status_code == 204
    assert admin.accounts[uuid.UUID(user_id)].banned is True
    assert accounts(session) == []
    assert session.get(Teacher, teacher.id) is not None
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {make_token(user_id)}"})
    assert me.status_code == 403


def test_delete_unknown_account_returns_404(director):
    assert director.delete(f"/users/{uuid.uuid4()}").status_code == 404


def test_director_cannot_deactivate_themselves(director, admin):
    response = director.delete(f"/users/{director.user.id}")

    assert response.status_code == 409
    assert admin.accounts[director.user.id].banned is False


def test_director_who_published_cannot_be_removed(director, admin, session, course):
    other = AppUser(id=uuid.uuid4(), role="director")
    session.add(other)
    session.flush()
    session.add(TimetablePublication(degree_id=course.degree_id, published_by=other.id))
    session.commit()
    admin.add(other.id, "other.director@unical.it")

    response = director.delete(f"/users/{other.id}")

    assert response.status_code == 409
    assert admin.accounts[other.id].banned is False


def test_delete_keeps_the_row_when_supabase_is_unreachable(director, admin, session, teacher):
    user_id = invite(director, email="ada@unical.it", role="teacher", teacher_id=teacher.id).json()["id"]
    admin.fail = AdminError(503, "Could not reach Supabase. Try again in a moment.")

    response = director.delete(f"/users/{user_id}")

    assert response.status_code == 503
    assert len(accounts(session)) == 1


def test_delete_works_when_the_director_degree_table_is_missing(director, admin, session, engine, teacher):
    # Supabase does not have director_degree yet: deactivating must not depend on it.
    user_id = invite(director, email="ada@unical.it", role="teacher", teacher_id=teacher.id).json()["id"]
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE director_degree"))

    response = director.delete(f"/users/{user_id}")

    assert response.status_code == 204, response.text
    assert admin.accounts[uuid.UUID(user_id)].banned is True
    assert accounts(session) == []


def test_delete_removes_the_directors_degree_links(director, admin, session, course):
    other = AppUser(id=uuid.uuid4(), role="director")
    session.add(other)
    session.flush()
    session.execute(director_degree.insert().values(user_id=other.id, degree_id=course.degree_id))
    session.commit()
    admin.add(other.id, "other.director@unical.it")

    assert director.delete(f"/users/{other.id}").status_code == 204
    assert session.execute(select(director_degree)).all() == []


def test_delete_removes_the_role_when_the_login_is_already_gone(director, admin, session, teacher):
    user_id = invite(director, email="ada@unical.it", role="teacher", teacher_id=teacher.id).json()["id"]
    del admin.accounts[uuid.UUID(user_id)]

    assert director.delete(f"/users/{user_id}").status_code == 204
    assert accounts(session) == []
