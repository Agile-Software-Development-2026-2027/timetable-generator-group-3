import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (register tables on Base.metadata)
from app.database import Base, get_session
from app.main import app
from app.models import Course, Degree, Semester, Year


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
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


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
