import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, joinedload

from app.database import get_session
from app.models import Course, Degree, Year, Semester, ScheduleSession

router = APIRouter(prefix="/courses", tags=["courses"])
Database = Annotated[Session, Depends(get_session)]


def trim_name(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


class CourseInput(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    degree_id: int
    year_id: int
    semester_id: int
    weekly_hours: int = Field(gt=0)
    enrolled_students: int = Field(gt=0)
    requires_lab: bool = False
    requires_projector: bool = False

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, value: object) -> object:
        return trim_name(value)

    @field_validator("weekly_hours", "enrolled_students", mode="before")
    @classmethod
    def validate_positive_integer(cls, value: object) -> int:
        if isinstance(value, str) and re.fullmatch(r"\s*\d+\s*", value, re.ASCII):
            value = int(value)

        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("Value must be a whole number.")

        if value <= 0:
            raise ValueError("Value must be greater than zero.")

        return value


class CourseView(BaseModel):
    id: int
    name: str
    degree_id: int
    degree: str
    year_id: int
    year: int
    semester_id: int
    semester: int
    weekly_hours: int
    enrolled_students: int
    requires_lab: bool
    requires_projector: bool


def load_course(course_id: int, session: Session) -> Course:
    course = session.scalar(
        select(Course)
        .where(Course.id == course_id)
        .options(
            joinedload(Course.semester)
            .joinedload(Semester.year)
            .joinedload(Year.degree)
        )
    )

    if course is None:
        raise HTTPException(404, "Course not found.")

    return course


def course_view(course: Course) -> CourseView:
    year = course.semester.year

    return CourseView(
        id=course.id,
        name=course.name,
        degree_id=year.degree.id,
        degree=year.degree.name,
        year_id=year.id,
        year=year.number,
        semester_id=course.semester.id,
        semester=course.semester.number,
        weekly_hours=course.weekly_hours,
        enrolled_students=course.enrolled_students,
        requires_lab=course.requires_lab,
        requires_projector=course.requires_projector,
    )


def validate_academic_structure(
    data: CourseInput, session: Session
) -> None:
    degree = session.get(Degree, data.degree_id)
    if degree is None:
        raise HTTPException(404, "Degree not found.")

    year = session.get(Year, data.year_id)
    if year is None or year.degree_id != data.degree_id:
        raise HTTPException(400, "The selected year does not belong to this degree.")

    semester = session.get(Semester, data.semester_id)
    if semester is None or semester.year_id != data.year_id:
        raise HTTPException(
            400, "The selected semester does not belong to this year."
        )


def ensure_unique_name(
    name: str,
    semester_id: int,
    session: Session,
    course_id: int | None = None,
) -> None:
    query = select(Course.id).where(
        func.lower(Course.name) == name.lower(),
        Course.semester_id == semester_id,
    )

    if course_id is not None:
        query = query.where(Course.id != course_id)

    if session.scalar(query):
        raise HTTPException(
            409,
            "A course with this name already exists in this degree, year and semester.",
        )


@router.get("", response_model=list[CourseView])
def list_courses(
    session: Database,
    degree_id: int | None = None,
    year_id: int | None = None,
    semester_id: int | None = None,
) -> list[CourseView]:

    query = (
        select(Course)
        .join(Course.semester)
        .join(Semester.year)
        .join(Year.degree)
        .options(
            joinedload(Course.semester)
            .joinedload(Semester.year)
            .joinedload(Year.degree)
        )
        .order_by(Course.name)
    )

    if degree_id is not None:
        query = query.where(Course.degree_id == degree_id)

    if year_id is not None:
        query = query.where(Course.year_id == year_id)

    if semester_id is not None:
        query = query.where(Course.semester_id == semester_id)

    return [course_view(course) for course in session.scalars(query)]


@router.post("", response_model=CourseView, status_code=201)
def create_course(data: CourseInput, session: Database) -> CourseView:

    validate_academic_structure(data, session)

    ensure_unique_name(data.name, data.semester_id, session)

    course = Course(**data.model_dump())

    session.add(course)
    session.commit()

    return course_view(load_course(course.id, session))


@router.get("/{course_id}", response_model=CourseView)
def get_course(course_id: int, session: Database) -> CourseView:

    return course_view(load_course(course_id, session))


@router.put("/{course_id}", response_model=CourseView)
def update_course(
    course_id: int,
    data: CourseInput,
    session: Database,
) -> CourseView:

    course = load_course(course_id, session)

    validate_academic_structure(data, session)

    ensure_unique_name(
        data.name,
        data.semester_id,
        session,
        course_id,
    )

    for field, value in data.model_dump().items():
        setattr(course, field, value)

    session.commit()

    return course_view(load_course(course_id, session))


@router.delete("/{course_id}", status_code=204)
def delete_course(
    course_id: int,
    session: Database,
    force: bool = False,
) -> None:

    course = load_course(course_id, session)

    scheduled = session.scalar(
        select(func.count(ScheduleSession.id)).where(
            ScheduleSession.course_id == course_id
        )
    )

    if scheduled and not force:
        raise HTTPException(
            409,
            f"This course is used in {scheduled} saved timetable session(s). "
            "Confirm to delete it anyway.",
        )

    if scheduled:
        session.execute(
            delete(ScheduleSession).where(
                ScheduleSession.course_id == course_id
            )
        )

    session.delete(course)
    session.commit()
