"""Course selection for students using the mixed enrollment model."""

from sqlalchemy import Select, and_, or_, select
from sqlalchemy.orm import Session

from app.models import Course, Enrollment, Student


def derived_course_filter(student: Student):
    """Courses belonging to the student's degree and academic year."""
    return and_(
        Course.degree_id == student.degree_id,
        Course.year_id == student.year_id,
    )


def student_course_filter(student: Student):
    """Include default courses and explicitly enrolled extra courses."""
    extra_course_ids = select(Enrollment.course_id).where(
        Enrollment.student_id == student.id
    )

    return or_(
        derived_course_filter(student),
        Course.id.in_(extra_course_ids),
    )


def student_course_ids_query(student: Student) -> Select:
    """Reusable course ID query for personal timetable filtering."""
    return select(Course.id).where(student_course_filter(student))


def list_student_courses(
    session: Session,
    student: Student,
) -> list[Course]:
    """Return each course once, including courses from all semesters."""
    query = (
        select(Course)
        .where(student_course_filter(student))
        .order_by(Course.name, Course.id)
    )

    return list(session.scalars(query).all())
