"""Human-readable explanations for courses omitted from a generated timetable."""
from __future__ import annotations

from app.engine.engine import Solution
from app.engine.facts import Problem
from app.models import Course, Room

Slot = tuple[int, int]


def _room_list(rooms: list[Room]) -> str:
    return ", ".join(f"{room.code} ({room.capacity} seats)" for room in rooms)


def _reason(category: str, message: str) -> str:
    return f"{category}: {message}"


def _room_constraint_reason(course: Course, rooms: list[Room]) -> str:
    capacity_rooms = [room for room in rooms if room.capacity >= course.enrolled_students]
    if course.requires_lab:
        labs = [room for room in rooms if room.is_lab]
        suitable_labs = [room for room in labs if room.capacity >= course.enrolled_students]
        if not labs:
            return _reason(
                "Lab capacity",
                f"No lab room is configured. Available rooms: {_room_list(rooms)}.",
            )
        if not suitable_labs:
            largest_lab = max(labs, key=lambda room: (room.capacity, room.code))
            return _reason(
                "Lab capacity",
                f"No lab fits {course.enrolled_students} students. Largest available "
                f"lab: {largest_lab.code} ({largest_lab.capacity} seats).",
            )
        capacity_rooms = suitable_labs

    if not capacity_rooms:
        return _reason(
            "Room capacity",
            f"No room fits {course.enrolled_students} students: {_room_list(rooms)}.",
        )

    if course.requires_projector:
        projector_rooms = [room for room in capacity_rooms if room.has_projector]
        if not projector_rooms:
            return _reason(
                "Room equipment",
                f"No projector-equipped room fits: {_room_list(capacity_rooms)}.",
            )

    return _reason("Room suitability", "No suitable room available.")


def _solution_assignments(solution: Solution | None):
    return solution.assignments if solution is not None else []


def unscheduled_course_reason(
    problem: Problem,
    course: Course,
    solution: Solution | None,
) -> str:
    """Explain a missing course using its requirements and occupied resources."""
    if not problem.slots:
        return _reason("Grid capacity", "No timetable slots are available in the configured grid.")
    if not problem.rooms:
        return _reason("Room availability", "No rooms are configured for this timetable.")

    eligible_rooms = [
        room for room in problem.rooms
        if room.capacity >= course.enrolled_students
        and (not course.requires_lab or room.is_lab)
        and (not course.requires_projector or room.has_projector)
    ]
    if not eligible_rooms:
        # Give the most specific sub-reason we can; fall back to the ticket
        # wording ("No suitable room available") when no clearer diagnosis fits.
        return _room_constraint_reason(course, problem.rooms)

    slots = set(problem.slots)
    semester_courses = [
        item for item in problem.courses if item.semester_id == course.semester_id
    ]
    semester_required = sum(item.weekly_hours for item in semester_courses)
    externally_busy_group_slots: set[Slot] = {
        (day, slot)
        for semester_id, day, slot in problem.busy_groups
        if semester_id == course.semester_id
    }
    group_grid_capacity = len(slots - externally_busy_group_slots)
    if semester_required > group_grid_capacity:
        available_slot_label = "slot" if group_grid_capacity == 1 else "slots"
        required_slot_label = "hour" if semester_required == 1 else "hours"
        return _reason(
            "Grid capacity",
            f"Grid has {group_grid_capacity} {available_slot_label}; this semester "
            f"needs {semester_required} weekly {required_slot_label}.",
        )

    assignments = _solution_assignments(solution)
    courses_by_id = {item.id: item for item in problem.courses}

    for teacher in course.teachers:
        busy_slots = {
            (day, slot)
            for teacher_id, day, slot in problem.busy_teachers
            if teacher_id == teacher.id
        }
        busy_slots.update(
            (assignment.day, assignment.slot)
            for assignment in assignments
            if assignment.course_id != course.id
            and teacher in courses_by_id[assignment.course_id].teachers
        )
        free_count = len(slots - busy_slots)
        if free_count < course.weekly_hours:
            if free_count == 0:
                return _reason(
                    "Teacher availability",
                    f"{teacher.name} has no free slots.",
                )
            return _reason(
                "Teacher availability",
                f"{teacher.name} has {free_count} free slots; course needs "
                f"{course.weekly_hours} weekly hours.",
            )

    group_busy_slots = externally_busy_group_slots | {
        (assignment.day, assignment.slot)
        for assignment in assignments
        if courses_by_id[assignment.course_id].semester_id == course.semester_id
    }
    group_free_slots = slots - group_busy_slots
    if len(group_free_slots) < course.weekly_hours:
        return _reason(
            "Grid capacity",
            f"Semester has {len(group_free_slots)} free slots; course needs "
            f"{course.weekly_hours} weekly hours.",
        )

    room_free_slots: set[Slot] = set()
    room_free_counts: list[tuple[Room, int]] = []
    for room in eligible_rooms:
        busy_slots = {
            (day, slot)
            for room_id, day, slot in problem.busy_rooms
            if room_id == room.id
        }
        busy_slots.update(
            (assignment.day, assignment.slot)
            for assignment in assignments
            if assignment.room_id == room.id
        )
        free_slots = slots - busy_slots
        room_free_slots.update(free_slots)
        room_free_counts.append((room, len(free_slots)))
    if len(room_free_slots) < course.weekly_hours:
        availability = ", ".join(
            f"{room.code} ({free_count} free)"
            for room, free_count in room_free_counts
        )
        return _reason(
            "Room availability",
            f"No eligible room has enough free slots ({availability}).",
        )

    mutually_free_slots = group_free_slots & room_free_slots
    for teacher in course.teachers:
        teacher_busy = {
            (day, slot)
            for teacher_id, day, slot in problem.busy_teachers
            if teacher_id == teacher.id
        }
        teacher_busy.update(
            (assignment.day, assignment.slot)
            for assignment in assignments
            if assignment.course_id != course.id
            and teacher in courses_by_id[assignment.course_id].teachers
        )
        mutually_free_slots -= teacher_busy
    if len(mutually_free_slots) < course.weekly_hours:
        return _reason(
            "Combined availability",
            f"No common free slots for {course.name} across its teacher, room, "
            "and semester.",
        )

    if solution is not None and solution.timed_out:
        return _reason("Scheduling timeout", "Scheduling timed out before this course could be placed.")
    return _reason("Scheduling constraint", f"No valid slot found for {course.name}.")
