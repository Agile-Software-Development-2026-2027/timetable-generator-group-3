"""Tests for the mixed student course selection model."""

import pytest

from app.models import Course, Degree, Enrollment, Semester, Student, Year
from app.student_courses import list_student_courses, student_course_ids_query


@pytest.fixture
def course_selection(session):
    first = Year(
        number=1,
        semesters=[Semester(number=1), Semester(number=2)],
    )
    second = Year(number=2, semesters=[Semester(number=1)])
    other = Year(number=1, semesters=[Semester(number=1)])
    empty = Year(number=3, semesters=[Semester(number=1)])

    cs = Degree(name="Computer Science", years=[first, second, empty])
    maths = Degree(name="Mathematics", years=[other])
    session.add_all([cs, maths])
    session.flush()

    def make_course(name, degree, year, semester):
        return Course(
            name=name,
            degree_id=degree.id,
            year_id=year.id,
            semester_id=semester.id,
            weekly_hours=4,
            enrolled_students=30,
        )

    databases = make_course("Databases", cs, first, first.semesters[0])
    programming = make_course("Programming", cs, first, first.semesters[1])
    ai = make_course("Artificial Intelligence", cs, second, second.semesters[0])
    statistics = make_course("Statistics", maths, other, other.semesters[0])
    geometry = make_course("Geometry", maths, other, other.semesters[0])

    student = Student(
        name="Student One",
        student_number="001001",
        degree_id=cs.id,
        year_id=first.id,
    )
    another = Student(
        name="Student Two",
        student_number="001002",
        degree_id=cs.id,
        year_id=first.id,
    )
    empty_student = Student(
        name="Student Three",
        student_number="001003",
        degree_id=cs.id,
        year_id=empty.id,
    )

    session.add_all([
        databases, programming, ai, statistics, geometry,
        student, another, empty_student,
    ])
    session.commit()

    return {
        "student": student,
        "another": another,
        "empty_student": empty_student,
        "databases": databases,
        "programming": programming,
        "ai": ai,
        "statistics": statistics,
        "geometry": geometry,
    }


def enroll(session, student, course):
    session.add(Enrollment(student_id=student.id, course_id=course.id))
    session.commit()


def course_ids(session, student):
    return [course.id for course in list_student_courses(session, student)]


def test_derived_courses_include_all_semesters(session, course_selection):
    data = course_selection
    assert set(course_ids(session, data["student"])) == {
        data["databases"].id,
        data["programming"].id,
    }


def test_unrelated_degree_and_year_are_excluded(session, course_selection):
    data = course_selection
    ids = course_ids(session, data["student"])
    for key in ("ai", "statistics", "geometry"):
        assert data[key].id not in ids


def test_extra_course_from_another_degree(session, course_selection):
    data = course_selection
    enroll(session, data["student"], data["statistics"])

    assert set(course_ids(session, data["student"])) == {
        data["databases"].id,
        data["programming"].id,
        data["statistics"].id,
    }


def test_extra_course_from_another_year(session, course_selection):
    data = course_selection
    enroll(session, data["student"], data["ai"])
    assert data["ai"].id in course_ids(session, data["student"])


def test_derived_and_enrolled_course_returned_once(session, course_selection):
    data = course_selection
    enroll(session, data["student"], data["databases"])

    ids = course_ids(session, data["student"])
    assert ids.count(data["databases"].id) == 1
    assert len(ids) == 2


def test_other_student_enrollment_is_excluded(session, course_selection):
    data = course_selection
    enroll(session, data["another"], data["statistics"])

    assert data["statistics"].id not in course_ids(session, data["student"])
    assert data["statistics"].id in course_ids(session, data["another"])


def test_student_without_courses_returns_empty_list(session, course_selection):
    assert list_student_courses(session, course_selection["empty_student"]) == []


def test_course_id_query_matches_mixed_selection(session, course_selection):
    data = course_selection
    enroll(session, data["student"], data["statistics"])

    ids = set(session.scalars(student_course_ids_query(data["student"])).all())

    assert ids == {
        data["databases"].id,
        data["programming"].id,
        data["statistics"].id,
    }
