from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_session
from app.models import Course, Semester, Teacher, Year

router = APIRouter(tags=["teachers"])
Database = Annotated[Session, Depends(get_session)]


def _trim(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


class TeacherInput(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    identifier: str = Field(min_length=1, max_length=255)
    # None on update keeps the current assignments unchanged.
    course_ids: list[int] | None = None

    _trim_text = field_validator("name", "identifier", mode="before")(_trim)


class CourseAssignment(BaseModel):
    teacher_ids: list[int]


class CourseSummary(BaseModel):
    id: int
    name: str
    degree: str


class TeacherSummary(BaseModel):
    id: int
    name: str
    identifier: str


class TeacherView(TeacherSummary):
    course_count: int
    courses: list[CourseSummary]


class CourseTeachersView(CourseSummary):
    teachers: list[TeacherSummary]


def course_summary(course: Course) -> CourseSummary:
    return CourseSummary(
        id=course.id, name=course.name, degree=course.semester.year.degree.name
    )


def teacher_view(teacher: Teacher) -> TeacherView:
    courses = sorted(teacher.courses, key=lambda course: (course.name, course.id))
    return TeacherView(
        id=teacher.id,
        name=teacher.name,
        identifier=teacher.identifier,
        course_count=len(courses),
        courses=[course_summary(course) for course in courses],
    )


def course_view(course: Course) -> CourseTeachersView:
    teachers = sorted(course.teachers, key=lambda teacher: (teacher.name, teacher.id))
    return CourseTeachersView(
        **course_summary(course).model_dump(),
        teachers=[
            TeacherSummary(id=t.id, name=t.name, identifier=t.identifier)
            for t in teachers
        ],
    )


def load_teacher(teacher_id: int, session: Session) -> Teacher:
    teacher = session.get(Teacher, teacher_id)
    if teacher is None:
        raise HTTPException(404, "Teacher not found.")
    return teacher


def load_courses(course_ids: list[int], session: Session) -> list[Course]:
    wanted = set(course_ids)
    courses = list(session.scalars(select(Course).where(Course.id.in_(wanted))))
    missing = wanted - {course.id for course in courses}
    if missing:
        raise HTTPException(404, f"Course(s) not found: {sorted(missing)}.")
    return courses


def ensure_unique_identifier(
    identifier: str, session: Session, teacher_id: int | None = None
) -> None:
    query = select(Teacher.id).where(
        func.lower(Teacher.identifier) == identifier.lower()
    )
    if teacher_id is not None:
        query = query.where(Teacher.id != teacher_id)
    if session.scalar(query):
        raise HTTPException(
            409, f"A teacher with the identifier '{identifier}' already exists."
        )


teacher_courses = selectinload(Teacher.courses).joinedload(Course.semester)


@router.get("/teachers", response_model=list[TeacherView])
def list_teachers(session: Database) -> list[TeacherView]:
    query = (
        select(Teacher)
        .options(
            teacher_courses.joinedload(Semester.year).joinedload(Year.degree)
        )
        .order_by(Teacher.name, Teacher.id)
    )
    return [teacher_view(teacher) for teacher in session.scalars(query)]


@router.post("/teachers", response_model=TeacherView, status_code=201)
def create_teacher(data: TeacherInput, session: Database) -> TeacherView:
    ensure_unique_identifier(data.identifier, session)
    teacher = Teacher(name=data.name, identifier=data.identifier)
    teacher.courses = load_courses(data.course_ids or [], session)
    session.add(teacher)
    session.commit()
    return get_teacher(teacher.id, session)


@router.get("/teachers/{teacher_id}", response_model=TeacherView)
def get_teacher(teacher_id: int, session: Database) -> TeacherView:
    return teacher_view(load_teacher(teacher_id, session))


@router.put("/teachers/{teacher_id}", response_model=TeacherView)
def update_teacher(
    teacher_id: int, data: TeacherInput, session: Database
) -> TeacherView:
    teacher = load_teacher(teacher_id, session)
    ensure_unique_identifier(data.identifier, session, teacher_id)
    teacher.name = data.name
    teacher.identifier = data.identifier
    if data.course_ids is not None:
        teacher.courses = load_courses(data.course_ids, session)
    session.commit()
    return get_teacher(teacher_id, session)


@router.delete("/teachers/{teacher_id}", status_code=204)
def delete_teacher(teacher_id: int, session: Database, force: bool = False) -> None:
    teacher = load_teacher(teacher_id, session)
    assigned = len(teacher.courses)
    if assigned and not force:
        raise HTTPException(
            409,
            f"This teacher is assigned to {assigned} course(s). Unassign them "
            "first, or confirm to delete the teacher and remove the assignments.",
        )
    teacher.courses = []
    session.delete(teacher)
    session.commit()


def load_course(course_id: int, session: Session) -> Course:
    course = session.get(Course, course_id)
    if course is None:
        raise HTTPException(404, "Course not found.")
    return course


@router.get("/courses/{course_id}/teachers", response_model=CourseTeachersView)
def get_course_teachers(course_id: int, session: Database) -> CourseTeachersView:
    return course_view(load_course(course_id, session))


@router.put("/courses/{course_id}/teachers", response_model=CourseTeachersView)
def assign_course_teachers(
    course_id: int, data: CourseAssignment, session: Database
) -> CourseTeachersView:
    course = load_course(course_id, session)
    wanted = set(data.teacher_ids)
    teachers = list(session.scalars(select(Teacher).where(Teacher.id.in_(wanted))))
    missing = wanted - {teacher.id for teacher in teachers}
    if missing:
        raise HTTPException(404, f"Teacher(s) not found: {sorted(missing)}.")
    course.teachers = teachers
    session.commit()
    session.refresh(course)
    return course_view(course)
