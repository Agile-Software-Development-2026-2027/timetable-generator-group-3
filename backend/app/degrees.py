from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_session
from app.models import Course, Degree, Semester, Year

router = APIRouter(prefix="/degrees", tags=["degrees"])
Database = Annotated[Session, Depends(get_session)]


def ensure_unique_degree_name(
    name: str, session: Session, degree_id: int | None = None
) -> None:
    name = name.strip()
    query = select(Degree.id).where(func.lower(Degree.name) == name.lower())
    if degree_id is not None:
        query = query.where(Degree.id != degree_id)
    if session.scalar(query):
        raise HTTPException(409, "A degree with this name already exists.")


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
    courses: int


class YearView(BaseModel):
    id: int
    number: int
    courses: int
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
        .order_by(func.lower(Degree.name), Degree.id)
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
def create_degree(data: DegreeInput, session: Database) -> DegreeView:
    ensure_unique_degree_name(data.name, session)
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
    return get_degree(degree.id, session)


@router.get("/{degree_id}", response_model=DegreeView)
def get_degree(degree_id: int, session: Database) -> DegreeView:
    degree = session.scalar(
        select(Degree)
        .where(Degree.id == degree_id)
        .options(selectinload(Degree.years).selectinload(Year.semesters))
    )
    if degree is None:
        raise HTTPException(404, "Degree not found.")
    year_ids = [year.id for year in degree.years]
    course_counts = {}
    semester_ids = [
        semester.id for year in degree.years for semester in year.semesters
    ]
    semester_course_counts = {}
    if year_ids:
        course_counts = {
            year_id: count
            for year_id, count in session.execute(
                select(Course.year_id, func.count(Course.id))
                .where(Course.year_id.in_(year_ids))
                .group_by(Course.year_id)
            )
        }
    if semester_ids:
        semester_course_counts = {
            semester_id: count
            for semester_id, count in session.execute(
                select(Course.semester_id, func.count(Course.id))
                .where(Course.semester_id.in_(semester_ids))
                .group_by(Course.semester_id)
            )
        }
    return DegreeView(
        id=degree.id,
        name=degree.name,
        years=[
            YearView(
                id=year.id,
                number=year.number,
                courses=course_counts.get(year.id, 0),
                semesters=[
                    SemesterView(
                        id=semester.id,
                        number=semester.number,
                        courses=semester_course_counts.get(semester.id, 0),
                    )
                    for semester in year.semesters
                ],
            )
            for year in degree.years
        ],
    )


@router.put("/{degree_id}", response_model=DegreeView)
def update_degree(degree_id: int, data: DegreeInput, session: Database) -> DegreeView:
    degree = session.get(Degree, degree_id)
    if degree is None:
        raise HTTPException(404, "Degree not found.")
    ensure_unique_degree_name(data.name, session, degree_id)
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
            semester
            for semester in year.semesters
            if semester.number > data.semesters_per_year
        ]
        if removed_semesters:
            course_exists = session.scalar(
                select(Course.id)
                .where(
                    Course.semester_id.in_(
                        [semester.id for semester in removed_semesters]
                    )
                )
                .limit(1)
            )
            if course_exists:
                raise HTTPException(409, "Semesters containing courses cannot be removed.")
    degree.name = data.name
    degree.years = [year for year in degree.years if year.number <= data.years]
    for number in range(1, data.years + 1):
        if not any(year.number == number for year in degree.years):
            degree.years.append(
                Year(
                    number=number,
                    semesters=[
                        Semester(number=semester_number)
                        for semester_number in range(1, data.semesters_per_year + 1)
                    ],
                )
            )
    degree.years.sort(key=lambda year: year.number)
    for year in degree.years:
        year.semesters = [
            semester
            for semester in year.semesters
            if semester.number <= data.semesters_per_year
        ]
        present_semesters = {semester.number for semester in year.semesters}
        for number in range(1, data.semesters_per_year + 1):
            if number not in present_semesters:
                year.semesters.append(Semester(number=number))
        year.semesters.sort(key=lambda semester: semester.number)
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
