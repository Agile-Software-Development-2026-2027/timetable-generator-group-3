import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from app.models import Course, Degree, Room, Semester, Teacher, Year

EXPECTED_TABLES = {
    "degree",
    "year",
    "semester",
    "course",
    "teacher",
    "room",
    "course_teacher",
    "schedule_session",
}


def test_models_create_all_tables(engine):
    tables = set(inspect(engine).get_table_names())
    assert EXPECTED_TABLES.issubset(tables)


def _make_course(session, **overrides):
    degree = Degree(name=overrides.get("degree_name", "Computer Science"))
    year = Year(number=1, degree=degree)
    semester = Semester(number=1, year=year)
    session.add_all([degree, year, semester])
    session.flush()
    course = Course(
        name=overrides.get("name", "Algorithms"),
        degree_id=degree.id,
        year_id=year.id,
        semester_id=semester.id,
        weekly_hours=overrides.get("weekly_hours", 4),
        enrolled_students=overrides.get("enrolled_students", 60),
        requires_lab=overrides.get("requires_lab", False),
    )
    session.add(course)
    return course


def test_degree_hierarchy_links(session):
    course = _make_course(session)
    session.commit()
    assert course.semester.year.degree.name == "Computer Science"


def test_boolean_flags_default_false(session):
    room = Room(code="A1", capacity=50)
    session.add(room)
    session.commit()
    assert room.has_projector is False
    assert room.has_computers is False
    assert room.is_lab is False


def test_course_teacher_many_to_many(session):
    course = _make_course(session)
    t1 = Teacher(name="Ada Lovelace", identifier="T001")
    t2 = Teacher(name="Alan Turing", identifier="T002")
    course.teachers.extend([t1, t2])
    session.add_all([t1, t2])
    session.commit()
    assert {t.identifier for t in course.teachers} == {"T001", "T002"}
    assert course in t1.courses


def test_weekly_hours_must_be_positive(session):
    with pytest.raises(IntegrityError):
        _make_course(session, weekly_hours=0)
        session.commit()


def test_room_capacity_must_be_positive(session):
    with pytest.raises(IntegrityError):
        session.add(Room(code="B2", capacity=0))
        session.commit()


def test_teacher_identifier_unique(session):
    session.add(Teacher(name="Grace Hopper", identifier="T100"))
    session.commit()
    with pytest.raises(IntegrityError):
        session.add(Teacher(name="Someone", identifier="T100"))
        session.commit()
