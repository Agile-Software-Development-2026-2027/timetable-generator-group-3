"""Personal student endpoints for authenticated student accounts."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_student
from app.database import get_session
from app.models import Course, Student
from app.student_courses import list_student_courses, student_course_ids_query
from app.student_enrollments import add_extra_enrollment, remove_extra_enrollment
from app.student_schemas import (
    AvailableCourseView,
    EnrollmentInput,
    EnrollmentView,
    StudentCourseView,
)
from app.student_timetable import (
    has_student_timetable_publication,
    list_student_published_sessions,
)
from app.timetable import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, SessionView


router = APIRouter(prefix="/students/me", tags=["student timetable"])
Database = Annotated[Session, Depends(get_session)]


CurrentStudent = Annotated[Student, Depends(get_current_student)]


class PublicationStatusView(BaseModel):
    published: bool


@router.get("/courses", response_model=list[StudentCourseView])
def read_personal_courses(
    session: Database,
    student: CurrentStudent,
) -> list[StudentCourseView]:
    courses = list_student_courses(session, student)
    return [
        StudentCourseView(
            **AvailableCourseView.model_validate(course).model_dump(),
            is_extra=(course.degree_id, course.year_id)
            != (student.degree_id, student.year_id),
        )
        for course in courses
    ]


@router.get("/available-courses", response_model=list[AvailableCourseView])
def read_available_courses(
    session: Database,
    student: CurrentStudent,
) -> list[AvailableCourseView]:
    query = (
        select(Course)
        .where(Course.id.not_in(student_course_ids_query(student)))
        .order_by(Course.name, Course.id)
    )
    return [
        AvailableCourseView.model_validate(course)
        for course in session.scalars(query).all()
    ]


@router.post("/enrollments", response_model=EnrollmentView, status_code=201)
def create_personal_enrollment(
    data: EnrollmentInput,
    session: Database,
    student: CurrentStudent,
) -> EnrollmentView:
    enrollment = add_extra_enrollment(session, student, data.course_id)
    return EnrollmentView.model_validate(enrollment)


@router.delete("/enrollments/{course_id}", status_code=204)
def delete_personal_enrollment(
    course_id: Annotated[int, Path(gt=0)],
    session: Database,
    student: CurrentStudent,
) -> None:
    remove_extra_enrollment(session, student, course_id)


@router.get("/timetable-status", response_model=PublicationStatusView)
def read_personal_timetable_status(
    session: Database,
    student: CurrentStudent,
) -> PublicationStatusView:
    return PublicationStatusView(
        published=has_student_timetable_publication(session, student)
    )


@router.get("/timetable", response_model=list[SessionView])
def read_personal_timetable(
    session: Database,
    student: CurrentStudent,
    response: Response,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> list[SessionView]:
    sessions, total = list_student_published_sessions(
        session, student, page=page, page_size=page_size
    )
    response.headers["X-Total-Count"] = str(total)
    return sessions
