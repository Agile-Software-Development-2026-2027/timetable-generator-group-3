from datetime import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.database import get_session
from app.models import Course, Room, ScheduleSession, Semester, Year

router = APIRouter(tags=["timetable"])
Database = Annotated[Session, Depends(get_session)]


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

    model_config = {"from_attributes": True}


@router.get("/courses")
def list_courses(session: Database) -> list[dict]:
    return [
        {"id": course.id, "name": course.name, "degree": course.semester.year.degree.name}
        for course in session.scalars(
            select(Course)
            .options(joinedload(Course.semester).joinedload(Semester.year).joinedload(Year.degree))
            .order_by(Course.name)
        )
    ]


@router.get("/rooms")
def list_rooms(session: Database) -> list[dict]:
    return [
        {"id": room.id, "code": room.code}
        for room in session.scalars(select(Room).order_by(Room.code))
    ]


@router.get("/timetable/sessions", response_model=list[SessionView])
def list_sessions(session: Database) -> list[ScheduleSession]:
    return list(session.scalars(select(ScheduleSession).options(joinedload(ScheduleSession.room))))


def save_session(record: ScheduleSession, data: SessionInput, session: Session) -> ScheduleSession:
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
def create_session(data: SessionInput, session: Database) -> ScheduleSession:
    record = save_session(ScheduleSession(), data, session)
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


@router.put("/timetable/sessions/{session_id}", response_model=SessionView)
def update_session(session_id: int, data: SessionInput, session: Database) -> ScheduleSession:
    record = session.get(ScheduleSession, session_id)
    if record is None:
        raise HTTPException(404, "Timetable session not found.")
    save_session(record, data, session)
    session.commit()
    session.refresh(record)
    return record


@router.delete("/timetable/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, session: Database) -> None:
    record = session.get(ScheduleSession, session_id)
    if record is None:
        raise HTTPException(404, "Timetable session not found.")
    session.delete(record)
    session.commit()
