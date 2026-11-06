"""Independent validation of an ASP solution before replacing database rows."""
from __future__ import annotations

from collections import Counter

from app.engine.engine import Solution
from app.engine.facts import Problem


class InvalidScheduleError(ValueError):
    """Clingo returned an assignment that violates scheduling rules."""


def validate_solution(problem: Problem, solution: Solution) -> None:
    """Check hours, room eligibility, overlaps and external reservations.

    This is a safety check, independent from the constraints in model.lp.
    Existing sessions outside the replacement scope are represented by
    problem.busy_* sets, calculated from the database by build_problem().
    """
    courses = {c.id: c for c in problem.courses}
    rooms = {r.id: r for r in problem.rooms}
    if len(courses) != len(problem.courses) or len(rooms) != len(problem.rooms):
        raise InvalidScheduleError("Duplicate course or room identifier in scheduling input.")
    if not solution.scheduled_ids <= courses.keys():
        raise InvalidScheduleError("Solution contains an unknown scheduled course.")

    counts: Counter[int] = Counter()
    occupied_rooms: set[tuple[int, int, int]] = set()
    occupied_groups: set[tuple[int, int, int]] = set()
    occupied_teachers: set[tuple[int, int, int]] = set()
    occupied_course_slots: set[tuple[int, int, int]] = set()

    for a in solution.assignments:
        course = courses.get(a.course_id)
        room = rooms.get(a.room_id)
        if course is None or a.course_id not in solution.scheduled_ids:
            raise InvalidScheduleError(f"Course {a.course_id} was not selected for scheduling.")
        if room is None:
            raise InvalidScheduleError(f"Room {a.room_id} does not exist.")
        if (a.day, a.slot) not in problem.slots:
            raise InvalidScheduleError(f"Slot ({a.day}, {a.slot}) does not exist.")
        if room.capacity < course.enrolled_students:
            raise InvalidScheduleError(f"Room capacity too small for course {course.id}.")
        if course.requires_lab and not room.is_lab:
            raise InvalidScheduleError(f"Course {course.id} requires a laboratory.")
        if course.requires_projector and not room.has_projector:
            raise InvalidScheduleError(f"Course {course.id} requires a projector.")

        course_slot = (course.id, a.day, a.slot)
        room_slot = (room.id, a.day, a.slot)
        group_slot = (course.semester_id, a.day, a.slot)
        if course_slot in occupied_course_slots:
            raise InvalidScheduleError(f"Course {course.id} has two sessions in one slot.")
        if room_slot in occupied_rooms or room_slot in problem.busy_rooms:
            raise InvalidScheduleError(f"Room {room.id} has conflicting sessions.")
        if group_slot in occupied_groups or group_slot in problem.busy_groups:
            raise InvalidScheduleError(f"Student group {course.semester_id} has conflicting sessions.")
        teacher_slots = {(t.id, a.day, a.slot) for t in course.teachers}
        if teacher_slots & (occupied_teachers | problem.busy_teachers):
            raise InvalidScheduleError(f"Course {course.id} has a teacher conflict.")
        occupied_course_slots.add(course_slot)
        occupied_rooms.add(room_slot)
        occupied_groups.add(group_slot)
        occupied_teachers.update(teacher_slots)
        counts[course.id] += 1

    for course in problem.courses:
        expected = course.weekly_hours if course.id in solution.scheduled_ids else 0
        if counts[course.id] != expected:
            raise InvalidScheduleError(
                f"Course {course.id}: expected {expected} sessions, got {counts[course.id]}."
            )
