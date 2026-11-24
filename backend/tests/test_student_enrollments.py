"""Tests for adding and removing extra student enrollments."""

import pytest
from fastapi import HTTPException

from app.models import Course, Degree, Enrollment, Semester, Student, Year
from app.student_enrollments import add_extra_enrollment, remove_extra_enrollment


@pytest.fixture
def enrollment_data(session, course):
    year = Year(number=1, semesters=[Semester(number=1)])
    degree = Degree(name="Mathematics", years=[year])
    session.add(degree)
    session.flush()

    extra = Course(
        name="Statistics",
        degree_id=degree.id,
        year_id=year.id,
        semester_id=year.semesters[0].id,
        weekly_hours=4,
        enrolled_students=30,
    )
    students = [
        Student(
            name=f"Student {number}",
            student_number=f"00100{number}",
            degree_id=course.degree_id,
            year_id=course.year_id,
        )
        for number in (1, 2)
    ]
    session.add_all([extra, *students])
    session.commit()
    return students[0], students[1], course, extra


def test_add_extra_enrollment(session, enrollment_data):
    student, _, _, extra = enrollment_data
    record = add_extra_enrollment(session, student, extra.id)

    assert record.student_id == student.id
    assert record.course_id == extra.id
    assert record.enrolled_at is not None
    assert session.get(Enrollment, (student.id, extra.id)) is not None


def test_duplicate_enrollment_returns_conflict(session, enrollment_data):
    student, _, _, extra = enrollment_data
    add_extra_enrollment(session, student, extra.id)

    with pytest.raises(HTTPException) as error:
        add_extra_enrollment(session, student, extra.id)

    assert error.value.status_code == 409
    assert session.get(Enrollment, (student.id, extra.id)) is not None


def test_derived_course_cannot_be_added(session, enrollment_data):
    student, _, derived, _ = enrollment_data

    with pytest.raises(HTTPException) as error:
        add_extra_enrollment(session, student, derived.id)

    assert error.value.status_code == 409
    assert session.get(Enrollment, (student.id, derived.id)) is None


def test_nonexistent_course_returns_not_found(session, enrollment_data):
    student, _, _, extra = enrollment_data

    with pytest.raises(HTTPException) as error:
        add_extra_enrollment(session, student, extra.id + 1000)

    assert error.value.status_code == 404


def test_remove_extra_enrollment(session, enrollment_data):
    student, _, _, extra = enrollment_data
    add_extra_enrollment(session, student, extra.id)
    remove_extra_enrollment(session, student, extra.id)

    assert session.get(Enrollment, (student.id, extra.id)) is None
    assert session.get(Course, extra.id) is not None


def test_remove_missing_enrollment(session, enrollment_data):
    student, _, _, extra = enrollment_data

    with pytest.raises(HTTPException) as error:
        remove_extra_enrollment(session, student, extra.id)

    assert error.value.status_code == 404


def test_cannot_remove_other_student_enrollment(session, enrollment_data):
    student, another, _, extra = enrollment_data
    add_extra_enrollment(session, another, extra.id)

    with pytest.raises(HTTPException) as error:
        remove_extra_enrollment(session, student, extra.id)

    assert error.value.status_code == 404
    assert session.get(Enrollment, (another.id, extra.id)) is not None


def test_cannot_remove_derived_course(session, enrollment_data):
    student, _, derived, _ = enrollment_data

    with pytest.raises(HTTPException) as error:
        remove_extra_enrollment(session, student, derived.id)

    assert error.value.status_code == 404
    assert session.get(Course, derived.id) is not None
    assert student.degree_id == derived.degree_id
    assert student.year_id == derived.year_id


def test_students_can_enroll_in_same_course(session, enrollment_data):
    student, another, _, extra = enrollment_data
    add_extra_enrollment(session, student, extra.id)
    add_extra_enrollment(session, another, extra.id)
    remove_extra_enrollment(session, student, extra.id)

    assert session.get(Enrollment, (student.id, extra.id)) is None
    assert session.get(Enrollment, (another.id, extra.id)) is not None


def test_reenroll_after_removal(session, enrollment_data):
    student, _, _, extra = enrollment_data
    add_extra_enrollment(session, student, extra.id)
    remove_extra_enrollment(session, student, extra.id)
    add_extra_enrollment(session, student, extra.id)

    assert session.get(Enrollment, (student.id, extra.id)) is not None
