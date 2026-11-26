"""Director-only management of student profiles."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import require_director
from app.database import get_session
from app.models import Degree, Student, Year


router = APIRouter(
    prefix="/students",
    tags=["students"],
    dependencies=[Depends(require_director)],
)

Database = Annotated[Session, Depends(get_session)]


class StudentInput(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    student_number: str = Field(min_length=1, max_length=32)
    degree_id: int = Field(gt=0)
    year_id: int = Field(gt=0)

    @field_validator("name", "student_number", mode="before")
    @classmethod
    def trim_fields(cls, value):
        return value.strip() if isinstance(value, str) else value


class StudentView(StudentInput):
    model_config = ConfigDict(from_attributes=True)

    id: int


def load_student(student_id: int, session: Session) -> Student:
    student = session.get(Student, student_id)

    if student is None:
        raise HTTPException(404, "Student not found.")

    return student


def validate_academic_structure(
    data: StudentInput,
    session: Session,
) -> None:
    if session.get(Degree, data.degree_id) is None:
        raise HTTPException(404, "Degree not found.")

    year = session.get(Year, data.year_id)

    if year is None:
        raise HTTPException(404, "Year not found.")

    if year.degree_id != data.degree_id:
        raise HTTPException(
            422, "The selected year does not belong to the selected degree."
        )


def ensure_unique_student_number(
    student_number: str,
    session: Session,
    student_id: int | None = None,
) -> None:
    query = select(Student.id).where(
        func.lower(Student.student_number) == student_number.lower()
    )

    if student_id is not None:
        query = query.where(Student.id != student_id)

    if session.scalar(query) is not None:
        raise HTTPException(409, "Student number already exists.")


def commit_student(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(
            409, "Student data conflicts with an existing database record."
        ) from error


@router.get("", response_model=list[StudentView])
def list_students(
    session: Database,
    degree_id: int | None = None,
    year_id: int | None = None,
) -> list[Student]:
    query = select(Student)

    if degree_id is not None:
        query = query.where(Student.degree_id == degree_id)

    if year_id is not None:
        query = query.where(Student.year_id == year_id)

    query = query.order_by(
        func.lower(Student.name), Student.id
    )

    return list(session.scalars(query).all())


@router.post("", response_model=StudentView, status_code=201)
def create_student(
    data: StudentInput,
    session: Database,
) -> Student:
    validate_academic_structure(data, session)

    ensure_unique_student_number(
        data.student_number, session
    )

    student = Student(**data.model_dump())
    session.add(student)

    commit_student(session)
    session.refresh(student)

    return student


@router.get("/{student_id}", response_model=StudentView)
def get_student(
    student_id: int,
    session: Database,
) -> Student:
    return load_student(student_id, session)


@router.put("/{student_id}", response_model=StudentView)
def update_student(
    student_id: int,
    data: StudentInput,
    session: Database,
) -> Student:
    student = load_student(student_id, session)

    validate_academic_structure(data, session)

    ensure_unique_student_number(
        data.student_number,
        session,
        student_id,
    )

    student.name = data.name
    student.student_number = data.student_number
    student.degree_id = data.degree_id
    student.year_id = data.year_id

    commit_student(session)
    session.refresh(student)

    return student


@router.delete("/{student_id}", status_code=204)
def delete_student(
    student_id: int,
    session: Database,
) -> None:
    student = load_student(student_id, session)

    session.delete(student)
    commit_student(session)
