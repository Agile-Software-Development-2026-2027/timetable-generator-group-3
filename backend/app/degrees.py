from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_session
from app.models import Course, Degree, Semester, Year

router = APIRouter(prefix="/degrees", tags=["degrees"])
Database = Annotated[Session, Depends(get_session)]


class DegreeInput(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    years: int = Field(ge=1, le=6)
    semesters_per_year: int = Field(default=2, ge=1, le=6)

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class DegreeSummary(BaseModel):
    id: int
    name: str
    years: int
    courses: int


class SemesterView(BaseModel):
    id: int
    number: int


class YearView(BaseModel):
    id: int
    number: int
    semesters: list[SemesterView]


class DegreeView(BaseModel):
    id: int
    name: str
    years: list[YearView]


@router.get("", response_model=list[DegreeSummary])
def list_degrees(session: Database) -> list[DegreeSummary]:
    rows = session.execute(
        select(Degree, func.count(Course.id))
        .outerjoin(Course, Course.degree_id == Degree.id)
        .group_by(Degree.id)
        .order_by(Degree.name)
    )
    return [
        DegreeSummary(
            id=degree.id,
            name=degree.name,
            years=len(degree.years),
            courses=course_count,
        )
        for degree, course_count in rows
    ]


@router.post("", response_model=DegreeView, status_code=201)
def create_degree(data: DegreeInput, session: Database) -> Degree:
    if session.scalar(select(Degree.id).where(Degree.name == data.name)):
        raise HTTPException(409, "A degree with this name already exists.")
    degree = Degree(name=data.name)
    degree.years = [
        Year(
            number=year_number,
            semesters=[
                Semester(number=semester_number)
                for semester_number in range(1, data.semesters_per_year + 1)
            ],
        )
        for year_number in range(1, data.years + 1)
    ]
    session.add(degree)
    session.commit()
    session.refresh(degree)
    return degree


@router.get("/{degree_id}", response_model=DegreeView)
def get_degree(degree_id: int, session: Database) -> Degree:
    degree = session.scalar(
        select(Degree)
        .where(Degree.id == degree_id)
        .options(selectinload(Degree.years).selectinload(Year.semesters))
    )
    if degree is None:
        raise HTTPException(404, "Degree not found.")
    return degree


@router.put("/{degree_id}", response_model=DegreeView)
def update_degree(degree_id: int, data: DegreeInput, session: Database) -> Degree:
    degree = session.get(Degree, degree_id)
    if degree is None:
        raise HTTPException(404, "Degree not found.")
    duplicate = session.scalar(
        select(Degree.id).where(Degree.name == data.name, Degree.id != degree_id)
    )
    if duplicate:
        raise HTTPException(409, "A degree with this name already exists.")
    removed_years = [year for year in degree.years if year.number > data.years]
    if removed_years:
        course_exists = session.scalar(
            select(Course.id)
            .where(Course.year_id.in_([year.id for year in removed_years]))
            .limit(1)
        )
        if course_exists:
            raise HTTPException(409, "Years containing courses cannot be removed.")
    for year in degree.years:
        removed_semesters = [
            semester for semester in year.semesters if semester.number > data.semesters_per_year
        ]
        if removed_semesters:
            course_exists = session.scalar(
                select(Course.id)
                .where(Course.semester_id.in_([semester.id for semester in removed_semesters]))
                .limit(1)
            )
            if course_exists:
                raise HTTPException(409, "Semesters containing courses cannot be removed.")
    degree.name = data.name
    degree.years = [year for year in degree.years if year.number <= data.years]
    present = {year.number for year in degree.years}
    degree.years.extend(
        Year(
            number=number,
            semesters=[
                Semester(number=semester_number)
                for semester_number in range(1, data.semesters_per_year + 1)
            ],
        )
        for number in range(1, data.years + 1)
        if number not in present
    )
    for year in degree.years:
        year.semesters = [
            semester for semester in year.semesters if semester.number <= data.semesters_per_year
        ]
        present_semesters = {semester.number for semester in year.semesters}
        year.semesters.extend(
            Semester(number=number)
            for number in range(1, data.semesters_per_year + 1)
            if number not in present_semesters
        )
    session.commit()
    return get_degree(degree_id, session)


@router.delete("/{degree_id}", status_code=204)
def delete_degree(degree_id: int, session: Database) -> None:
    degree = session.get(Degree, degree_id)
    if degree is None:
        raise HTTPException(404, "Degree not found.")
    if session.scalar(select(Course.id).where(Course.degree_id == degree_id).limit(1)):
        raise HTTPException(409, "A degree with courses cannot be deleted.")
    session.delete(degree)
    session.commit()
