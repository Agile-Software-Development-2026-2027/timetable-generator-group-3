from __future__ import annotations

import json
from datetime import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.models import Course, SlotConfig

router = APIRouter(prefix="/slot-config", tags=["slot-config"])
Database = Annotated[Session, Depends(get_session)]

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
CONFIG_ID = 1
DEFAULT_BLOCK_MINUTES = 30


def get_block_minutes(session: Session) -> int:
    """Return the configured block size, or the default if unset."""
    config = session.get(SlotConfig, CONFIG_ID)
    return config.block_minutes if config else DEFAULT_BLOCK_MINUTES



class SlotConfigInput(BaseModel):
    working_days: list[int]
    start_time: time
    end_time: time
    block_minutes: int
    # KAN-78: optional lunch break; both or neither.
    break_start: time | None = None
    break_end: time | None = None

    @field_validator("working_days")
    @classmethod
    def validate_days(cls, days: list[int]) -> list[int]:
        if not days:
            raise ValueError("At least one working day is required.")
        invalid = [d for d in days if d not in range(7)]
        if invalid:
            raise ValueError(f"Invalid weekday value(s): {invalid}. Use 0 (Mon) to 6 (Sun).")
        return sorted(set(days))

    @field_validator("block_minutes")
    @classmethod
    def validate_block(cls, minutes: int) -> int:
        if minutes <= 0:
            raise ValueError("Block length must be greater than zero minutes.")
        return minutes

    @model_validator(mode="after")
    def validate_time_range(self) -> SlotConfigInput:
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time.")
        total_minutes = (
            (self.end_time.hour * 60 + self.end_time.minute)
            - (self.start_time.hour * 60 + self.start_time.minute)
        )
        if total_minutes < self.block_minutes:
            raise ValueError(
                "The time range is shorter than one block. "
                "Increase the range or reduce the block length."
            )
        if (self.break_start is None) != (self.break_end is None):
            raise ValueError("Give both the start and the end of the lunch break, or neither.")
        if self.break_start is not None:
            if self.break_end <= self.break_start:
                raise ValueError("The lunch break must end after it starts.")
            if self.break_start < self.start_time or self.break_end > self.end_time:
                raise ValueError("The lunch break must be within the daily schedule.")
        return self


class TimeSlot(BaseModel):
    index: int
    start: str
    end: str


class SlotConfigView(BaseModel):
    working_days: list[int]
    working_day_names: list[str]
    start_time: str
    end_time: str
    block_minutes: int
    blocks_per_day: int
    break_start: str | None = None
    break_end: str | None = None


class SlotGrid(BaseModel):
    config: SlotConfigView
    grid: dict[str, list[TimeSlot]]


def _load_or_create(session: Session) -> SlotConfig:
    config = session.get(SlotConfig, CONFIG_ID)
    if config is None:
        config = SlotConfig(
            id=CONFIG_ID,
            working_days="[0,1,2,3,4]",
            start_time=time(9, 0),
            end_time=time(18, 0),
            block_minutes=DEFAULT_BLOCK_MINUTES,
        )
        session.add(config)
        session.commit()
        session.refresh(config)
    return config


def _minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def _day_slots(config: SlotConfig) -> list[TimeSlot]:
    """The blocks of one working day.

    KAN-78: blocks that overlap the lunch break are left out. The other blocks
    keep their position in the day as index, so the block after lunch is not
    consecutive to the one before it: a session never runs across the break,
    and changing rooms over lunch needs no travel buffer.
    """
    start_min = _minutes(config.start_time)
    end_min = _minutes(config.end_time)
    block = config.block_minutes
    break_start = getattr(config, "break_start", None)
    break_end = getattr(config, "break_end", None)

    slots: list[TimeSlot] = []
    cursor = start_min
    idx = 0
    while cursor + block <= end_min:
        slot_end = cursor + block
        in_break = (
            break_start is not None and break_end is not None
            and cursor < _minutes(break_end) and slot_end > _minutes(break_start)
        )
        if not in_break:
            slots.append(TimeSlot(
                index=idx,
                start=f"{cursor // 60:02d}:{cursor % 60:02d}",
                end=f"{slot_end // 60:02d}:{slot_end % 60:02d}",
            ))
        cursor = slot_end
        idx += 1
    return slots


def _to_view(config: SlotConfig) -> SlotConfigView:
    days = json.loads(config.working_days)
    break_start = getattr(config, "break_start", None)
    break_end = getattr(config, "break_end", None)
    return SlotConfigView(
        working_days=days,
        working_day_names=[WEEKDAY_NAMES[d] for d in days],
        start_time=config.start_time.strftime("%H:%M"),
        end_time=config.end_time.strftime("%H:%M"),
        block_minutes=config.block_minutes,
        blocks_per_day=len(_day_slots(config)),
        break_start=break_start.strftime("%H:%M") if break_start else None,
        break_end=break_end.strftime("%H:%M") if break_end else None,
    )


def _build_grid(config: SlotConfig) -> dict[str, list[TimeSlot]]:
    days = json.loads(config.working_days)
    slots = _day_slots(config)
    return {WEEKDAY_NAMES[d]: slots for d in days}


@router.get("", response_model=SlotConfigView)
def get_slot_config(session: Database) -> SlotConfigView:
    return _to_view(_load_or_create(session))


@router.put("", response_model=SlotConfigView)
def update_slot_config(data: SlotConfigInput, session: Database) -> SlotConfigView:
    incompatible = session.execute(
        select(
            Course.id,
            Course.name,
            Course.session_duration_minutes,
        )
        .where(
            Course.session_duration_minutes % data.block_minutes != 0
        )
        .order_by(Course.id)
        .limit(1)
    ).first()

    if incompatible is not None:
        course_id, name, duration = incompatible
        raise HTTPException(
            status_code=422,
            detail=(
                f"Cannot set grid block to {data.block_minutes} minutes: "
                f"course '{name}' (ID {course_id}) has a "
                f"{duration}-minute session, which is not a "
                "multiple of the proposed block size."
            ),
        )

    config = _load_or_create(session)
    config.working_days = json.dumps(data.working_days)
    config.start_time = data.start_time
    config.end_time = data.end_time
    config.block_minutes = data.block_minutes
    config.break_start = data.break_start
    config.break_end = data.break_end
    session.commit()
    session.refresh(config)
    return _to_view(config)


@router.get("/grid", response_model=SlotGrid)
def get_slot_grid(session: Database) -> SlotGrid:
    config = _load_or_create(session)
    return SlotGrid(config=_to_view(config), grid=_build_grid(config))
