"""Build ASP facts from the existing SQLAlchemy models and KAN-14 slot grid."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import time

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Course, Room, ScheduleSession, SlotConfig, TeacherAvailability
from app.slot_config import _build_grid, WEEKDAY_NAMES


DEFAULT_SESSION_MINUTES = 60


@dataclass
class Problem:
    courses: list[Course]
    rooms: list[Room]
    slots: dict[tuple[int, int], tuple[time, time]]
    facts: str
    group_capacity: dict[int, int]
    buffer_slots: int = 0
    busy_rooms: set[tuple[int, int, int]] = field(default_factory=set)
    busy_teachers: set[tuple[int, int, int]] = field(default_factory=set)
    busy_groups: set[tuple[int, int, int]] = field(default_factory=set)
    # KAN-57: (teacher_id, day, slot) from teacher availability ranges.
    unavailable_teachers: set[tuple[int, int, int]] = field(default_factory=set)
    preferred_slots: set[tuple[int, int, int]] = field(default_factory=set)
    # KAN-52: grid blocks per session and sessions per week, by course id.
    # A course missing from these maps uses one block per session and
    # weekly_hours sessions (the behaviour before multi-block sessions).
    session_blocks: dict[int, int] = field(default_factory=dict)
    sessions_per_week: dict[int, int] = field(default_factory=dict)

    def blocks_of(self, course_id: int) -> int:
        return self.session_blocks.get(course_id, 1)

    def sessions_of(self, course) -> int:
        return self.sessions_per_week.get(course.id, course.weekly_hours)

    def required_blocks(self, course) -> int:
        """Grid blocks a course occupies in one week."""
        return self.sessions_of(course) * self.blocks_of(course.id)

    def covered_slots(self, course_id: int, day: int, start: int) -> list[tuple[int, int]]:
        """Every (day, slot) of a session that starts at (day, start)."""
        return [(day, start + offset) for offset in range(self.blocks_of(course_id))]


def _minute(t: time) -> int:
    return t.hour * 60 + t.minute


def _ceil_div(a: int, b: int) -> int:
    return -(-a // b)


def session_shape(course, block_minutes: int) -> tuple[int, int]:
    """Return (blocks per session, sessions per week) for a course.

    The session length comes from `session_duration_minutes` (KAN-51) and
    falls back to 60 minutes. Both values round up, so a course is never
    given less time than requested when the lengths do not divide exactly
    (the courses API validates exact multiples).
    """
    minutes = getattr(course, "session_duration_minutes", None) or DEFAULT_SESSION_MINUTES
    blocks = max(1, _ceil_div(minutes, block_minutes))
    sessions = max(1, _ceil_div(course.weekly_hours * 60, minutes))
    return blocks, sessions


def start_slots(
    slots: dict[tuple[int, int], tuple[time, time]], blocks: int
) -> list[tuple[int, int]]:
    """Slots where a session of `blocks` consecutive blocks can start.

    Every block S..S+blocks-1 must exist on the same day and each one must
    begin exactly when the previous one ends, so a session never runs past
    the end of the day or across a gap in the grid.
    """
    starts: list[tuple[int, int]] = []
    for day, index in sorted(slots):
        fits = True
        for offset in range(1, blocks):
            current = slots.get((day, index + offset))
            previous = slots[(day, index + offset - 1)]
            if current is None or current[0] != previous[1]:
                fits = False
                break
        if fits:
            starts.append((day, index))
    return starts


def availability_slots(
    entries: list[TeacherAvailability],
    slots: dict[tuple[int, int], tuple[time, time]],
) -> tuple[set[tuple[int, int, int]], set[tuple[int, int, int]]]:
    """KAN-57: map availability ranges to the grid slots they overlap.

    Returns (unavailable, preferred) sets of (teacher_id, day, slot). Shared with
    workload limits (KAN-72), which build on the same table and facts.
    """
    unavailable: set[tuple[int, int, int]] = set()
    preferred: set[tuple[int, int, int]] = set()
    for entry in entries:
        target = unavailable if entry.availability_type == "unavailable" else preferred
        for (day, index), (start, end) in slots.items():
            if day == entry.weekday and _minute(entry.start_time) < _minute(end) \
                    and _minute(entry.end_time) > _minute(start):
                target.add((entry.teacher_id, day, index))
    return unavailable, preferred


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
                            block_minutes=30)
        # Use in-memory defaults without inserting configuration during generation.
    grid = _build_grid(config)
    slots: dict[tuple[int, int], tuple[time, time]] = {}
    for day_name, blocks in grid.items():
        weekday = WEEKDAY_NAMES.index(day_name)
        for block in blocks:
            slots[(weekday, block.index)] = (
                time.fromisoformat(block.start), time.fromisoformat(block.end)
            )

    # KAN-53: minimum 15-minute travel buffer, rounded up to whole slots.
    buffer_slots = (15 + config.block_minutes - 1) // config.block_minutes
    lines: list[str] = [f"buffer_slots({buffer_slots})."]
    session_blocks: dict[int, int] = {}
    sessions_per_week: dict[int, int] = {}
    starts_by_blocks: dict[int, list[tuple[int, int]]] = {}
    for c in courses:
        # KAN-52: a session lasts `blocks` consecutive slots, `sessions` times a week.
        blocks, sessions = session_shape(c, config.block_minutes)
        session_blocks[c.id] = blocks
        sessions_per_week[c.id] = sessions
        if blocks not in starts_by_blocks:
            starts_by_blocks[blocks] = start_slots(slots, blocks)
        lines.extend((
            f"course({c.id},{c.weekly_hours}).",
            f"sessions({c.id},{sessions}).",
            f"duration({c.id},{blocks}).",
            f"students({c.id},{c.enrolled_students}).",
            f"group({c.id},{c.semester_id}).",
        ))
        lines.extend(f"start_ok({c.id},{day},{index})." for day, index in starts_by_blocks[blocks])
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
    # KAN-57: unavailable ranges reuse the busy_teacher hard constraint;
    # preferred ranges feed the prefers_slot soft constraint in model.lp.
    teacher_ids = {teacher.id for c in courses for teacher in c.teachers}
    entries = list(session.scalars(
        select(TeacherAvailability).where(TeacherAvailability.teacher_id.in_(teacher_ids))
    )) if teacher_ids else []
    unavailable, preferred = availability_slots(entries, slots)
    for teacher_id, day, index in unavailable:
        busy.add(f"busy_teacher({teacher_id},{day},{index}).")
    busy_teachers |= unavailable
    lines.extend(sorted(busy))
    lines.extend(sorted(f"prefers_slot({t},{d},{s})." for t, d, s in preferred))
    group_capacity = {c.semester_id: len(slots) for c in courses}
    return Problem(
        courses, rooms, slots, "\n".join(lines), group_capacity,
        busy_rooms=busy_rooms, busy_teachers=busy_teachers, busy_groups=busy_groups,
        buffer_slots=buffer_slots,
        session_blocks=session_blocks, sessions_per_week=sessions_per_week,
        unavailable_teachers=unavailable, preferred_slots=preferred,
    )
