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
    # KAN-78: blocks of each session, by course id, when a course mixes session
    # lengths (e.g. [3, 2]). Takes precedence over the two maps above.
    session_parts: dict[int, list[int]] = field(default_factory=dict)

    def session_lengths(self, course) -> list[int]:
        """Blocks of every weekly session of a course, longest first."""
        parts = self.session_parts.get(course.id)
        if parts:
            return parts
        sessions = self.sessions_per_week.get(course.id, course.weekly_hours)
        return [self.session_blocks.get(course.id, 1)] * sessions

    def blocks_of(self, course_id: int) -> int:
        """Blocks of the longest session of a course."""
        parts = self.session_parts.get(course_id)
        return max(parts) if parts else self.session_blocks.get(course_id, 1)

    def sessions_of(self, course) -> int:
        return len(self.session_lengths(course))

    def required_blocks(self, course) -> int:
        """Grid blocks a course occupies in one week."""
        return sum(self.session_lengths(course))

    def covered_slots(
        self, course_id: int, day: int, start: int, blocks: int | None = None
    ) -> list[tuple[int, int]]:
        """Every (day, slot) of a session that starts at (day, start).

        `blocks` is the length of that session; it defaults to the longest
        session of the course.
        """
        length = blocks or self.blocks_of(course_id)
        return [(day, start + offset) for offset in range(length)]


def _minute(t: time) -> int:
    return t.hour * 60 + t.minute


def _ceil_div(a: int, b: int) -> int:
    return -(-a // b)


def session_lengths(course, block_minutes: int) -> list[int]:
    """KAN-78: blocks of each weekly session of a course, longest first.

    `session_duration_minutes` is the longest a session may last (falls back
    to 60 minutes). The weekly hours are split evenly into the fewest sessions
    that don't exceed it: with a 3-hour maximum, 5 h is 3 + 2, 4 h is 2 + 2 and
    11 h is 3 + 3 + 3 + 2. When the length divides the weekly hours, every
    session has that length (the KAN-52 behaviour). Lengths round up to whole
    blocks, so a course never gets less time than requested.
    """
    longest = getattr(course, "session_duration_minutes", None) or DEFAULT_SESSION_MINUTES
    # Split in whole blocks when the session length is a multiple of the block;
    # otherwise in whole sessions, each rounded up to whole blocks.
    unit = block_minutes if longest % block_minutes == 0 else longest
    total_units = max(1, _ceil_div(course.weekly_hours * 60, unit))
    max_units = max(1, longest // unit)
    count = _ceil_div(total_units, max_units)
    base, extra = divmod(total_units, count)
    units = [base + 1] * extra + [base] * (count - extra)
    return [max(1, _ceil_div(size * unit, block_minutes)) for size in units]


def session_shape(course, block_minutes: int) -> tuple[int, int]:
    """Return (blocks of the longest session, sessions per week) for a course."""
    lengths = session_lengths(course, block_minutes)
    return max(lengths), len(lengths)


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
    session_parts: dict[int, list[int]] = {}
    lengths_in_use: set[int] = set()
    for c in courses:
        # KAN-52/KAN-78: part(C,B,N) — N weekly sessions of B consecutive blocks.
        parts = session_lengths(c, config.block_minutes)
        session_parts[c.id] = parts
        lengths_in_use.update(parts)
        lines.extend((
            f"course({c.id},{c.weekly_hours}).",
            f"students({c.id},{c.enrolled_students}).",
            f"group({c.id},{c.semester_id}).",
        ))
        lines.extend(
            f"part({c.id},{blocks},{parts.count(blocks)})." for blocks in sorted(set(parts))
        )
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
    # fits(B,D,S): a session of B blocks can start at (D,S) without running past
    # the end of the day or across a gap in the grid (e.g. the lunch break).
    for blocks in sorted(lengths_in_use):
        lines.extend(f"fits({blocks},{day},{index})." for day, index in start_slots(slots, blocks))

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
        session_parts=session_parts,
        unavailable_teachers=unavailable, preferred_slots=preferred,
    )
