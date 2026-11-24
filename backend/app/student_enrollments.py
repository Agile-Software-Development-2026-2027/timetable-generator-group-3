"""Manage additional course enrollments for student profiles."""

from fastapi import HTTPException
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Course, Enrollment, Student


def add_extra_enrollment(session: Session, student: Student, course_id: int) -> Enrollment:
    """Enroll a student in a course outside their default course set."""
    student_id = student.id
    course = session.get(Course, course_id)
    if course is None:
        raise HTTPException(404, "Course not found.")

    if (course.degree_id, course.year_id) == (student.degree_id, student.year_id):
        raise HTTPException(409, "Course is already included in your degree and year.")

    key = (student_id, course_id)
    if session.get(Enrollment, key) is not None:
        raise HTTPException(409, "You are already enrolled in this course.")

    enrollment = Enrollment(student_id=student_id, course_id=course_id)
    session.add(enrollment)

    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        if session.get(Enrollment, key) is not None:
            raise HTTPException(409, "You are already enrolled in this course.") from error
        raise

    session.refresh(enrollment)
    return enrollment


def remove_extra_enrollment(session: Session, student: Student, course_id: int) -> None:
    """Remove only the supplied student's explicit enrollment."""
    result = session.execute(
        delete(Enrollment).where(
            Enrollment.student_id == student.id,
            Enrollment.course_id == course_id,
        )
    )
    if result.rowcount == 0:
        session.rollback()
        raise HTTPException(404, "Extra enrollment not found.")

    session.commit()
