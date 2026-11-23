from datetime import time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, contains_eager, joinedload

from app.auth import CurrentUser, get_current_user, require_director
from app.database import get_session
from app.models import Course, Degree, PublishedSession, Room, ScheduleSession, course_teacher


router = APIRouter(tags=["timetable"])
Database = Annotated[Session, Depends(get_session)]
Director = Annotated[CurrentUser, Depends(require_director)]

DEFAULT_PAGE_SIZE = 100
MAX_PAGE_SIZE = 500


class SessionInput(BaseModel):
    course_id: int
    room_id: int | None = None
    weekday: int = Field(ge=0, le=6, description="Monday=0, Sunday=6")
    start_time: time
    end_time: time

    @model_validator(mode="after")
    def validate_times(self):
        if self.start_time >= self.end_time:
            raise ValueError("End time must be after start time.")
        return self


class SessionView(SessionInput):
    id: int
    course_name: str
    degree_name: str
    room_code: str | None
    teacher_names: list[str]


def sessions_query(model=ScheduleSession):
    return (
        select(model, Degree.name)
        .join(model.course)
        .join(Degree, Degree.id == Course.degree_id)
        .options(
            contains_eager(model.course).selectinload(Course.teachers),
            joinedload(model.room),
        )
    )


def session_view(record: ScheduleSession, degree_name: str) -> SessionView:
    return SessionView(
        id=record.id,
        course_id=record.course_id,
        room_id=record.room_id,
        weekday=record.weekday,
        start_time=record.start_time,
        end_time=record.end_time,
        course_name=record.course.name,
        degree_name=degree_name,
        room_code=record.room.code if record.room else None,
        teacher_names=sorted(teacher.name for teacher in record.course.teachers),
    )


def get_session_view(session_id: int, session: Session) -> SessionView:
    row = session.execute(
        sessions_query().where(ScheduleSession.id == session_id)
    ).one()
    return session_view(*row)


@router.get("/timetable/sessions", response_model=list[SessionView])
def list_sessions(
    session: Database,
    response: Response,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    degree_id: int | None = None,
    year_id: int | None = None,
    semester_id: int | None = None,
    teacher_id: int | None = None,
    room_id: int | None = None,
    weekday: Annotated[int | None, Query(ge=0, le=6)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    version: Literal["draft", "published"] | None = None,
) -> list[SessionView]:
    if user.role != "director" and version == "draft":
        raise HTTPException(403, "Only directors can read draft timetables.")
    model = (
        ScheduleSession if user.role == "director" and version != "published"
        else PublishedSession
    )
    filters = []
    if degree_id is not None:
        filters.append(Course.degree_id == degree_id)
        if model is PublishedSession:
            filters.append(PublishedSession.degree_id == degree_id)
    if year_id is not None:
        filters.append(Course.year_id == year_id)
    if semester_id is not None:
        filters.append(Course.semester_id == semester_id)
    if teacher_id is not None:
        filters.append(Course.id.in_(
            select(course_teacher.c.course_id).where(
                course_teacher.c.teacher_id == teacher_id
            )
        ))
    if room_id is not None:
        filters.append(model.room_id == room_id)
    if weekday is not None:
        filters.append(model.weekday == weekday)

    total = session.scalar(
        select(func.count(model.id)).join(model.course).where(*filters)
    )
    response.headers["X-Total-Count"] = str(total)
    rows = session.execute(
        sessions_query(model).where(*filters)
        .order_by(model.weekday, model.start_time, model.id)
        .offset((page - 1) * page_size).limit(page_size)
    )
    return [session_view(record, degree_name) for record, degree_name in rows]


def save_session(
    record: ScheduleSession,
    data: SessionInput,
    session: Session,
) -> ScheduleSession:
    if session.get(Course, data.course_id) is None:
        raise HTTPException(404, "Course not found.")

    if data.room_id is not None and session.get(Room, data.room_id) is None:
        raise HTTPException(404, "Room not found.")

    record.course_id = data.course_id
    record.room_id = data.room_id
    record.weekday = data.weekday
    record.start_time = data.start_time
    record.end_time = data.end_time

    return record


@router.post("/timetable/sessions", response_model=SessionView, status_code=201)
def create_session(data: SessionInput, session: Database, _director: Director) -> SessionView:
    record = save_session(ScheduleSession(), data, session)
    session.add(record)
    session.commit()
    return get_session_view(record.id, session)


@router.put("/timetable/sessions/{session_id}", response_model=SessionView)
def update_session(
    session_id: int,
    data: SessionInput,
    session: Database,
    _director: Director,
) -> SessionView:
    record = session.get(ScheduleSession, session_id)

    if record is None:
        raise HTTPException(404, "Timetable session not found.")

    save_session(record, data, session)
    session.commit()

    return get_session_view(session_id, session)


@router.delete("/timetable/sessions", status_code=204)
def clear_sessions(
    session: Database,
    degree_id: Annotated[int, Query(gt=0)],
    _director: Director,
) -> None:
    # degree_id is required so a bare DELETE can never wipe every timetable.
    if session.get(Degree, degree_id) is None:
        raise HTTPException(404, "Degree not found.")

    session.execute(
        delete(ScheduleSession).where(
            ScheduleSession.course_id.in_(
                select(Course.id).where(Course.degree_id == degree_id)
            )
        )
    )
    session.commit()


@router.delete("/timetable/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, session: Database, _director: Director) -> None:
    record = session.get(ScheduleSession, session_id)

    if record is None:
        raise HTTPException(404, "Timetable session not found.")

    session.delete(record)
    session.commit()
