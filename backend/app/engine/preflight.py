"""KAN-67: lightweight checks before timetable generation."""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Literal

from app.engine.facts import Problem
from app.engine.reasons import (
    _grid_capacity_message,
    _room_list,
    _room_constraint_reason,
    _teacher_workload_reason,
)


@dataclass(frozen=True)
class PreflightWarning:
    type: str
    severity: Literal["error", "warning"]
    message: str
    course_id: int | None = None
    teacher_id: int | None = None


def _course_warnings(problem: Problem) -> list[PreflightWarning]:
    warnings: list[PreflightWarning] = []

    for course in problem.courses:
        def add(kind, message, severity="error", *, course=course):
            warnings.append(
                PreflightWarning(
                    type=kind,
                    severity=severity,
                    message=f"{course.name}: {message}",
                    course_id=course.id,
                )
            )

        if not course.teachers:
            add(
                "missing_teacher",
                "No teacher is assigned.",
                "warning",
            )

        has_capacity = any(
            room.capacity >= course.enrolled_students
            for room in problem.rooms
        )
        has_lab = not course.requires_lab or any(
            room.is_lab for room in problem.rooms
        )
        has_projector = not course.requires_projector or any(
            room.has_projector for room in problem.rooms
        )

        if not has_capacity:
            add(
                "room_capacity",
                f"No room fits {course.enrolled_students} students. "
                f"Available rooms: {_room_list(problem.rooms) or 'none'}.",
            )

        if not has_lab:
            add("missing_lab", "No laboratory room is configured.")

        if not has_projector:
            add(
                "missing_projector",
                "No projector-equipped room is configured.",
            )


        if has_capacity and has_lab and has_projector and not any(
            room.capacity >= course.enrolled_students
            and (not course.requires_lab or room.is_lab)
            and (not course.requires_projector or room.has_projector)
            for room in problem.rooms
        ):
            add(
                "room_suitability",
                _room_constraint_reason(course, problem.rooms),
            )

    return warnings


def _semester_warnings(problem: Problem) -> list[PreflightWarning]:
    warnings: list[PreflightWarning] = []
    semesters = defaultdict(list)

    for course in problem.courses:
        semesters[course.semester_id].append(course)

    for semester_id, courses in semesters.items():
        required = sum(
            problem.required_blocks(course) for course in courses
        )
        busy = {
            (day, slot)
            for group, day, slot in problem.busy_groups
            if group == semester_id
        }
        capacity = len(set(problem.slots) - busy)

        if required > capacity:
            warnings.append(
                PreflightWarning(
                    type="semester_capacity",
                    severity="error",
                    message=(
                        f"Semester {semester_id}: "
                        + _grid_capacity_message(
                            problem, courses, capacity, required
                        )
                    ),
                    course_id=courses[0].id,
                )
            )

    return warnings


def _teacher_warnings(problem: Problem) -> list[PreflightWarning]:
    warnings: list[PreflightWarning] = []
    teachers = {}
    courses_by_teacher = defaultdict(list)

    for course in problem.courses:
        for teacher in course.teachers:
            teachers[teacher.id] = teacher
            courses_by_teacher[teacher.id].append(course)

    slots = set(problem.slots)

    for teacher_id, courses in courses_by_teacher.items():
        teacher = teachers[teacher_id]

        busy = {
            (day, slot)
            for tid, day, slot in problem.busy_teachers
            if tid == teacher_id
        }
        free = slots - busy

        if not free:
            warnings.append(
                PreflightWarning(
                    type="teacher_unavailable",
                    severity="error",
                    message=f"{teacher.name} has no available teaching slots.",
                    teacher_id=teacher_id,
                )
            )
            continue

        workload = problem.teacher_workloads.get(teacher_id)

        if workload is None:
            continue

        required = sum(
            problem.required_blocks(course) for course in courses
        )

        external = {
            (day, slot)
            for tid, day, slot in problem.external_teaching
            if tid == teacher_id
        }

        free_by_day = Counter(day for day, _ in free)
        external_by_day = Counter(day for day, _ in external)

        # Existing external violations may remain, but not get worse.
        if workload.max_daily_slots is not None:
            for day in free_by_day:
                remaining = max(
                    0,
                    workload.max_daily_slots - external_by_day[day],
                )
                free_by_day[day] = min(
                    free_by_day[day], remaining
                )

        capacity = sum(free_by_day.values())

        if workload.max_teaching_days is not None:
            external_days = set(external_by_day)
            remaining_days = max(
                0,
                workload.max_teaching_days - len(external_days),
            )

            existing_capacity = sum(
                free_by_day[day] for day in external_days
            )
            new_capacity = sorted(
                (
                    count for day, count in free_by_day.items()
                    if day not in external_days
                ),
                reverse=True,
            )

            capacity = existing_capacity + sum(
                new_capacity[:remaining_days]
            )

        message = None

        if capacity < required and capacity < len(free):
            message = (
                f"{teacher.name} requires {required} teaching slots, "
                f"but workload limits allow at most {capacity}."
            )

        if message is None:
            # Reuse existing workload explanations for session-length
            # and consecutive teaching constraints.
            for course in courses:
                reason = _teacher_workload_reason(
                    problem, course, None, teacher_id=teacher_id
                )
                if reason is not None:
                    message = reason
                    break

        if message is not None:
            warnings.append(
                PreflightWarning(
                    type="teacher_workload",
                    severity="error",
                    message=message,
                    teacher_id=teacher_id,
                )
            )

    return warnings


def check_preflight(problem: Problem) -> list[PreflightWarning]:
    """Collect data problems without solving or changing the timetable."""
    return [
        *_course_warnings(problem),
        *_semester_warnings(problem),
        *_teacher_warnings(problem),
    ]
