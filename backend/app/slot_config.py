from __future__ import annotations

import json
from datetime import time
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy.orm import Session

from app.database import get_session
from app.models import SlotConfig

router = APIRouter(prefix="/slot-config", tags=["slot-config"])
Database = Annotated[Session, Depends(get_session)]

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
CONFIG_ID = 1


class SlotConfigInput(BaseModel):
    working_days: list[int]
    start_time: time
    end_time: time
    block_minutes: int

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
            block_minutes=60,
        )
        session.add(config)
        session.commit()
        session.refresh(config)
    return config


def _to_view(config: SlotConfig) -> SlotConfigView:
    days = json.loads(config.working_days)
    start = config.start_time
    end = config.end_time
    total = (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)
    blocks = total // config.block_minutes
    return SlotConfigView(
        working_days=days,
        working_day_names=[WEEKDAY_NAMES[d] for d in days],
        start_time=config.start_time.strftime("%H:%M"),
        end_time=config.end_time.strftime("%H:%M"),
        block_minutes=config.block_minutes,
        blocks_per_day=blocks,
    )


def _build_grid(config: SlotConfig) -> dict[str, list[TimeSlot]]:
    days = json.loads(config.working_days)
    start_min = config.start_time.hour * 60 + config.start_time.minute
    end_min = config.end_time.hour * 60 + config.end_time.minute
    block = config.block_minutes

    slots: list[TimeSlot] = []
    cursor = start_min
    idx = 0
    while cursor + block <= end_min:
        slot_start = f"{cursor // 60:02d}:{cursor % 60:02d}"
        cursor += block
        slot_end = f"{cursor // 60:02d}:{cursor % 60:02d}"
        slots.append(TimeSlot(index=idx, start=slot_start, end=slot_end))
        idx += 1

    return {WEEKDAY_NAMES[d]: slots for d in days}


@router.get("", response_model=SlotConfigView)
def get_slot_config(session: Database) -> SlotConfigView:
    return _to_view(_load_or_create(session))


@router.put("", response_model=SlotConfigView)
def update_slot_config(data: SlotConfigInput, session: Database) -> SlotConfigView:
    config = _load_or_create(session)
    config.working_days = json.dumps(data.working_days)
    config.start_time = data.start_time
    config.end_time = data.end_time
    config.block_minutes = data.block_minutes
    session.commit()
    session.refresh(config)
    return _to_view(config)


@router.get("/grid", response_model=SlotGrid)
def get_slot_grid(session: Database) -> SlotGrid:
    config = _load_or_create(session)
    return SlotGrid(config=_to_view(config), grid=_build_grid(config))
