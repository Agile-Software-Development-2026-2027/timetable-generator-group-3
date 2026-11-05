"""Build ASP facts from the existing SQLAlchemy models and KAN-14 slot grid."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import time

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Course, Room, ScheduleSession, SlotConfig
from app.slot_config import _build_grid, WEEKDAY_NAMES


@dataclass
class Problem:
    courses: list[Course]
    rooms: list[Room]
    slots: dict[tuple[int, int], tuple[time, time]]
    facts: str
    group_capacity: dict[int, int]
    busy_rooms: set[tuple[int, int, int]] = field(default_factory=set)
    busy_teachers: set[tuple[int, int, int]] = field(default_factory=set)
    busy_groups: set[tuple[int, int, int]] = field(default_factory=set)


def _minute(t: time) -> int:
    return t.hour * 60 + t.minute


def build_problem(session: Session, degree_id: int, semester_id: int | None) -> Problem:
    query = select(Course).options(selectinload(Course.teachers)).where(
        Course.degree_id == degree_id
    ).order_by(Course.id)
    if semester_id is not None:
        query = query.where(Course.semester_id == semester_id)
    courses = list(session.scalars(query).all())
    rooms = list(session.scalars(select(Room).order_by(Room.id)).all())

    config = session.get(SlotConfig, 1)
    if config is None:
        # Same defaults as KAN-14, 
        config = SlotConfig(id=1, working_days="[0,1,2,3,4]",
                            start_time=time(9, 0), end_time=time(18, 0),
                            block_minutes=60)
        # Use in-memory defaults without inserting configuration during generation.
    grid = _build_grid(config)
    slots: dict[tuple[int, int], tuple[time, time]] = {}
    for day_name, blocks in grid.items():
        weekday = WEEKDAY_NAMES.index(day_name)
        for block in blocks:
            slots[(weekday, block.index)] = (
                time.fromisoformat(block.start), time.fromisoformat(block.end)
            )

    lines: list[str] = []
    for c in courses:
        lines.extend((
            f"course({c.id},{c.weekly_hours}).",
            f"students({c.id},{c.enrolled_students}).",
            f"group({c.id},{c.semester_id}).",
        ))
        if c.requires_lab:
            lines.append(f"requires_lab({c.id}).")
        if c.requires_projector:
            lines.append(f"requires_projector({c.id}).")
        for teacher in c.teachers:
            lines.append(f"teaches({teacher.id},{c.id}).")
    for r in rooms:
        lines.append(f"room({r.id},{r.capacity}).")
        if r.is_lab:
            lines.append(f"is_lab({r.id}).")
        if r.has_projector:
            lines.append(f"has_projector({r.id}).")
    for day, index in slots:
        lines.append(f"slot({day},{index}).")

    # Exclude ALL sessions for courses in this scope: they will be replaced.
    selected_ids = {c.id for c in courses}
    external = session.scalars(
        select(ScheduleSession)
        .options(selectinload(ScheduleSession.course).selectinload(Course.teachers))
    ).all()
    busy: set[str] = set()
    busy_rooms: set[tuple[int, int, int]] = set()
    busy_teachers: set[tuple[int, int, int]] = set()
    busy_groups: set[tuple[int, int, int]] = set()
    for existing in external:
        if existing.course_id in selected_ids:
            continue
        for (day, index), (start, end) in slots.items():
            if existing.weekday != day:
                continue
            if _minute(existing.start_time) >= _minute(end) or _minute(existing.end_time) <= _minute(start):
                continue
            if existing.room_id is not None:
                busy.add(f"busy_room({existing.room_id},{day},{index}).")
                busy_rooms.add((existing.room_id, day, index))
            for teacher in existing.course.teachers:
                busy.add(f"busy_teacher({teacher.id},{day},{index}).")
                busy_teachers.add((teacher.id, day, index))
            busy.add(f"busy_group({existing.course.semester_id},{day},{index}).")
            busy_groups.add((existing.course.semester_id, day, index))
    lines.extend(sorted(busy))
    group_capacity = {c.semester_id: len(slots) for c in courses}
    return Problem(
        courses, rooms, slots, "\n".join(lines), group_capacity,
        busy_rooms=busy_rooms, busy_teachers=busy_teachers, busy_groups=busy_groups,
    )
