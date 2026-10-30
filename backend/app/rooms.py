import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.database import get_session
from app.models import Room, ScheduleSession

router = APIRouter(prefix="/rooms", tags=["rooms"])
Database = Annotated[Session, Depends(get_session)]


class RoomInput(BaseModel):
    code: str = Field(min_length=1, max_length=255)
    capacity: int
    has_projector: bool = False
    has_computers: bool = False
    is_lab: bool = False

    @field_validator("code", mode="before")
    @classmethod
    def trim_code(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("capacity", mode="before")
    @classmethod
    def check_capacity(cls, value: object) -> int:
        if isinstance(value, str) and re.fullmatch(r"\s*[+-]?\d+\s*", value, re.ASCII):
            value = int(value)
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("Capacity must be a whole number.")
        if value <= 0:
            raise ValueError("Capacity must be greater than zero.")
        return value


class RoomView(BaseModel):
    id: int
    code: str
    capacity: int
    has_projector: bool
    has_computers: bool
    is_lab: bool
    scheduled_sessions: int


def room_view(room: Room, scheduled_sessions: int) -> RoomView:
    return RoomView(
        id=room.id,
        code=room.code,
        capacity=room.capacity,
        has_projector=room.has_projector,
        has_computers=room.has_computers,
        is_lab=room.is_lab,
        scheduled_sessions=scheduled_sessions,
    )


def count_sessions(room_id: int, session: Session) -> int:
    return session.scalar(
        select(func.count(ScheduleSession.id)).where(ScheduleSession.room_id == room_id)
    )


def ensure_unique_code(code: str, session: Session, room_id: int | None = None) -> None:
    query = select(Room.id).where(func.lower(Room.code) == code.lower())
    if room_id is not None:
        query = query.where(Room.id != room_id)
    if session.scalar(query):
        raise HTTPException(409, "A room with this code already exists.")


@router.get("", response_model=list[RoomView])
def list_rooms(
    session: Database,
    has_projector: bool | None = None,
    has_computers: bool | None = None,
    is_lab: bool | None = None,
) -> list[RoomView]:
    query = (
        select(Room, func.count(ScheduleSession.id))
        .outerjoin(ScheduleSession, ScheduleSession.room_id == Room.id)
        .group_by(Room.id)
        .order_by(Room.code)
    )
    filters = (
        (Room.has_projector, has_projector),
        (Room.has_computers, has_computers),
        (Room.is_lab, is_lab),
    )
    for column, value in filters:
        if value is not None:
            query = query.where(column == value)
    return [room_view(room, scheduled) for room, scheduled in session.execute(query)]


@router.post("", response_model=RoomView, status_code=201)
def create_room(data: RoomInput, session: Database) -> RoomView:
    ensure_unique_code(data.code, session)
    room = Room(**data.model_dump())
    session.add(room)
    session.commit()
    session.refresh(room)
    return room_view(room, 0)


@router.get("/{room_id}", response_model=RoomView)
def get_room(room_id: int, session: Database) -> RoomView:
    room = session.get(Room, room_id)
    if room is None:
        raise HTTPException(404, "Room not found.")
    return room_view(room, count_sessions(room_id, session))


@router.put("/{room_id}", response_model=RoomView)
def update_room(room_id: int, data: RoomInput, session: Database) -> RoomView:
    room = session.get(Room, room_id)
    if room is None:
        raise HTTPException(404, "Room not found.")
    ensure_unique_code(data.code, session, room_id)
    for field, value in data.model_dump().items():
        setattr(room, field, value)
    session.commit()
    return get_room(room_id, session)


@router.delete("/{room_id}", status_code=204)
def delete_room(room_id: int, session: Database, force: bool = False) -> None:
    room = session.get(Room, room_id)
    if room is None:
        raise HTTPException(404, "Room not found.")
    scheduled = count_sessions(room_id, session)
    if scheduled and not force:
        raise HTTPException(
            409,
            f"This room is used by {scheduled} scheduled class(es) in the saved "
            "timetable. Confirm to delete it anyway.",
        )
    session.execute(
        update(ScheduleSession)
        .where(ScheduleSession.room_id == room_id)
        .values(room_id=None)
    )
    session.delete(room)
    session.commit()
