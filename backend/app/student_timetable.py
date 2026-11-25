"""Published timetable queries for an already resolved student profile."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import PublishedSession, Student, TimetablePublication
from app.student_courses import student_course_ids_query
from app.timetable import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    SessionView,
    session_view,
    sessions_query,
)


def student_published_session_filter(student: Student):
    """Restrict published sessions to the student's personal courses."""
    return PublishedSession.course_id.in_(
        student_course_ids_query(student)
    )


def has_student_timetable_publication(
    session: Session,
    student: Student,
) -> bool:
    """Check publication independently of the number of visible sessions."""
    return session.get(
        TimetablePublication,
        student.degree_id,
    ) is not None


def list_student_published_sessions(
    session: Session,
    student: Student,
    *,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> tuple[list[SessionView], int]:
    """Return a page of personal published sessions and the filtered total."""
    if page < 1 or not 1 <= page_size <= MAX_PAGE_SIZE:
        raise ValueError("Invalid timetable pagination.")

    course_filter = student_published_session_filter(student)

    total = session.scalar(
        select(func.count(PublishedSession.id)).where(course_filter)
    )

    rows = session.execute(
        sessions_query(PublishedSession)
        .where(course_filter)
        .order_by(
            PublishedSession.weekday,
            PublishedSession.start_time,
            PublishedSession.id,
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    return [
        session_view(record, degree_name)
        for record, degree_name in rows
    ], int(total or 0)
