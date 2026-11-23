"""KAN-57: teachers' unavailable and preferred time ranges."""
from __future__ import annotations

import json
from datetime import time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.database import get_session
from app.models import Teacher, TeacherAvailability
from app.slot_config import WEEKDAY_NAMES, _load_or_create

router = APIRouter(prefix="/teachers", tags=["availability"])
Database = Annotated[Session, Depends(get_session)]


class AvailabilityEntry(BaseModel):
    weekday: int = Field(ge=0, le=6, description="Monday=0, Sunday=6")
    start_time: time
    end_time: time
    availability_type: Literal["unavailable", "preferred"]

    @model_validator(mode="after")
    def check_time_order(self) -> AvailabilityEntry:
        if self.start_time >= self.end_time:
            raise ValueError("end_time must be after start_time.")
        return self


class AvailabilityView(AvailabilityEntry):
    id: int

    model_config = {"from_attributes": True}


def _load_teacher(teacher_id: int, session: Session) -> Teacher:
    teacher = session.get(Teacher, teacher_id)
    if teacher is None:
        raise HTTPException(404, "Teacher not found.")
    return teacher


def _validate_against_grid(entries: list[AvailabilityEntry], session: Session) -> None:
    config = _load_or_create(session)
    working_days = json.loads(config.working_days)
    day_range = f"{config.start_time:%H:%M}–{config.end_time:%H:%M}"
    for number, entry in enumerate(entries, start=1):
        if entry.weekday not in working_days:
            raise HTTPException(
                422, f"Entry {number}: {WEEKDAY_NAMES[entry.weekday]} is not a working day."
            )
        if entry.start_time < config.start_time or entry.end_time > config.end_time:
            raise HTTPException(
                422, f"Entry {number}: times must be within the working day ({day_range})."
            )
    for first, a in enumerate(entries, start=1):
        for second, b in enumerate(entries[first:], start=first + 1):
            overlap = (
                a.weekday == b.weekday
                and a.start_time < b.end_time
                and b.start_time < a.end_time
            )
            if overlap and a.availability_type != b.availability_type:
                raise HTTPException(
                    422,
                    f"Entries {first} and {second} overlap on {WEEKDAY_NAMES[a.weekday]} "
                    "but one is unavailable and the other preferred.",
                )


def _list(teacher_id: int, session: Session) -> list[TeacherAvailability]:
    query = (
        select(TeacherAvailability)
        .where(TeacherAvailability.teacher_id == teacher_id)
        .order_by(TeacherAvailability.weekday, TeacherAvailability.start_time)
    )
    return list(session.scalars(query))


@router.get("/{teacher_id}/availability", response_model=list[AvailabilityView])
def get_availability(teacher_id: int, session: Database) -> list[TeacherAvailability]:
    _load_teacher(teacher_id, session)
    return _list(teacher_id, session)


@router.put("/{teacher_id}/availability", response_model=list[AvailabilityView])
def replace_availability(
    teacher_id: int, entries: list[AvailabilityEntry], session: Database
) -> list[TeacherAvailability]:
    _load_teacher(teacher_id, session)
    _validate_against_grid(entries, session)
    session.execute(
        delete(TeacherAvailability).where(TeacherAvailability.teacher_id == teacher_id)
    )
    session.add_all(
        TeacherAvailability(teacher_id=teacher_id, **entry.model_dump()) for entry in entries
    )
    session.commit()
    return _list(teacher_id, session)
