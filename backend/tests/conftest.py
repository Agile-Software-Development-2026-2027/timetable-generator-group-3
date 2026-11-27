import time
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (register tables on Base.metadata)
from app.config import Settings, get_settings
from app.database import Base, get_session
from app.main import app
from app.models import AppUser, Course, Degree, Semester, Year

# Tests sign their own tokens with this secret: no calls to Supabase.
# 32+ bytes so PyJWT does not warn about a short HMAC key.
TEST_JWT_SECRET = "test-only-jwt-secret-0123456789-abcdef"
# Every auth setting is passed explicitly so a developer's .env or shell
# variables (e.g. a real SUPABASE_URL) never change how tests verify tokens.
TEST_SETTINGS = Settings(
    _env_file=None,
    supabase_url="",
    supabase_jwt_secret=TEST_JWT_SECRET,
    supabase_jwks_url="",
    supabase_jwt_audience="authenticated",
)


@pytest.fixture()
def engine(tmp_path):
    db_url = f"sqlite:///{tmp_path / 'test.db'}"
    eng = create_engine(db_url, future=True)

    @event.listens_for(eng, "connect")
    def _fk_pragma(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture()
def session_factory(engine):
    return sessionmaker(bind=engine, future=True)


@pytest.fixture()
def session(session_factory):
    db = session_factory()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def client(session_factory):
    def override_get_session():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_settings] = lambda: TEST_SETTINGS
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def make_token():
    """Build a Supabase-like access token: make_token(user_id, expires_in=...)."""

    def _make_token(
        sub,
        *,
        secret=TEST_JWT_SECRET,
        expires_in=3600,
        audience="authenticated",
        **extra_claims,
    ):
        now = int(time.time())
        claims = {
            "sub": str(sub),
            "aud": audience,
            "role": "authenticated",
            "iat": now,
            "exp": now + expires_in,
            **extra_claims,
        }
        return jwt.encode(claims, secret, algorithm="HS256")

    return _make_token


@pytest.fixture()
def auth_client(client, session, make_token):
    """auth_client("director") -> a TestClient logged in as a new user with that role."""

    def _auth_client(role):
        user = AppUser(id=uuid.uuid4(), role=role)
        session.add(user)
        session.commit()
        token = make_token(user.id)
        return TestClient(app, headers={"Authorization": f"Bearer {token}"})

    return _auth_client

@pytest.fixture()
def director_client(auth_client):
    return auth_client("director")

@pytest.fixture()
def course(session):
    semester = Semester(number=1)
    year = Year(number=1, semesters=[semester])
    degree = Degree(name="Computer Science", years=[year])
    session.add(degree)
    session.flush()
    course = Course(
        name="Databases",
        degree_id=degree.id,
        year_id=year.id,
        semester_id=semester.id,
        weekly_hours=4,
        enrolled_students=80,
    )
    session.add(course)
    session.commit()
    return course
