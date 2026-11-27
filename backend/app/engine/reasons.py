"""Human-readable explanations for courses omitted from a generated timetable."""
from __future__ import annotations

from app.engine.engine import Solution
from app.engine.facts import DEFAULT_SESSION_MINUTES, Problem, start_slots
from app.models import Course, Room

Slot = tuple[int, int]


def _room_list(rooms: list[Room]) -> str:
    return ", ".join(f"{room.code} ({room.capacity} seats)" for room in rooms)


def _reason(category: str, message: str) -> str:
    return f"{category}: {message}"


def _slots(count: int) -> str:
    return f"{count} slot" if count == 1 else f"{count} slots"


def _block_minutes(problem: Problem) -> int | None:
    """Length of one grid slot, or None when the slots carry no times (tests)."""
    for start, end in problem.slots.values():
        if start is not None and end is not None:
            return (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)
    return None


def _grid_capacity_message(
    problem: Problem, semester_courses: list, capacity: int, required: int
) -> str:
    """KAN-77: the need is for the whole semester and counted in slots.

    When sessions do not fill whole slots (e.g. 60-minute sessions on a
    90-minute grid), say so: that is usually why the semester does not fit.
    """
    block = _block_minutes(problem)
    grid = _slots(capacity) + (f" of {block} min" if block else "")
    message = f"Grid has {grid}; this semester needs {_slots(required)}."
    if not block:
        return message
    rounded = sorted({
        minutes for item in semester_courses
        if (minutes := getattr(item, "session_duration_minutes", None) or DEFAULT_SESSION_MINUTES)
        % block
    })
    if rounded:
        lengths = " and ".join(str(minutes) for minutes in rounded)
        message += f" Sessions of {lengths} minutes are rounded up to whole {block}-minute slots."
    return message


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


def _covered(problem: Problem, assignment) -> list[Slot]:
    """Every (day, slot) block of a scheduled session (KAN-52)."""
    return problem.covered_slots(
        assignment.course_id, assignment.day, assignment.slot, assignment.blocks
    )


def _need_text(problem: Problem, course: Course) -> str:
    """How much grid time a course needs, in the clearest unit."""
    blocks = problem.blocks_of(course.id)
    sessions = problem.sessions_of(course)
    if blocks == 1 and sessions == course.weekly_hours:
        return f"{course.weekly_hours} weekly hours"
    return f"{sessions * blocks} slots ({sessions} sessions of {blocks} slots)"


def _fitting_sessions(problem: Problem, course: Course, starts: list[Slot]) -> int:
    """Most non-overlapping sessions that can start in `starts` (greedy per day)."""
    blocks = problem.blocks_of(course.id)
    count = 0
    next_free: dict[int, int] = {}
    for day, slot in sorted(starts):
        if slot >= next_free.get(day, slot):
            count += 1
            next_free[day] = slot + blocks
    return count


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

    # KAN-52: a session needs `blocks` consecutive slots on one day.
    blocks = problem.blocks_of(course.id)
    sessions = problem.sessions_of(course)
    grid_starts = start_slots(problem.slots, blocks)
    if not grid_starts:
        return _reason(
            "Session length",
            f"A session of {blocks} consecutive slots does not fit in one day of the grid.",
        )

    slots = set(problem.slots)
    semester_courses = [
        item for item in problem.courses if item.semester_id == course.semester_id
    ]
    semester_required = sum(problem.required_blocks(item) for item in semester_courses)
    externally_busy_group_slots: set[Slot] = {
        (day, slot)
        for semester_id, day, slot in problem.busy_groups
        if semester_id == course.semester_id
    }
    group_grid_capacity = len(slots - externally_busy_group_slots)
    if semester_required > group_grid_capacity:
        return _reason(
            "Grid capacity",
            _grid_capacity_message(
                problem, semester_courses, group_grid_capacity, semester_required
            ),
        )

    # KAN-57: the teacher marked every slot of the grid as unavailable.
    for teacher in course.teachers:
        blocked = {(d, s) for t, d, s in problem.unavailable_teachers if t == teacher.id}
        if not slots - blocked:
            return _reason(
                "Teacher availability",
                f"{teacher.name} has no available slot for {course.name}.",
            )

    assignments = _solution_assignments(solution)
    courses_by_id = {item.id: item for item in problem.courses}
    needed_blocks = problem.required_blocks(course)

    def teacher_busy_slots(teacher) -> set[Slot]:
        busy_slots = {
            (day, slot)
            for teacher_id, day, slot in problem.busy_teachers
            if teacher_id == teacher.id
        }
        for assignment in assignments:
            if (
                assignment.course_id != course.id
                and teacher in courses_by_id[assignment.course_id].teachers
            ):
                busy_slots.update(_covered(problem, assignment))
        return busy_slots

    for teacher in course.teachers:
        free_count = len(slots - teacher_busy_slots(teacher))
        if free_count < needed_blocks:
            if free_count == 0:
                return _reason(
                    "Teacher availability",
                    f"{teacher.name} has no free slots.",
                )
            return _reason(
                "Teacher availability",
                f"{teacher.name} has {free_count} free slots; course needs "
                f"{_need_text(problem, course)}.",
            )

    group_busy_slots = set(externally_busy_group_slots)
    for assignment in assignments:
        if courses_by_id[assignment.course_id].semester_id == course.semester_id:
            group_busy_slots.update(_covered(problem, assignment))
    group_free_slots = slots - group_busy_slots
    if len(group_free_slots) < needed_blocks:
        return _reason(
            "Grid capacity",
            f"Semester has {len(group_free_slots)} free slots; course needs "
            f"{_need_text(problem, course)}.",
        )

    room_busy: dict[int, set[Slot]] = {}
    room_free_slots: set[Slot] = set()
    room_free_counts: list[tuple[Room, int]] = []
    for room in eligible_rooms:
        busy_slots = {
            (day, slot)
            for room_id, day, slot in problem.busy_rooms
            if room_id == room.id
        }
        for assignment in assignments:
            if assignment.room_id == room.id:
                busy_slots.update(_covered(problem, assignment))
        room_busy[room.id] = busy_slots
        free_slots = slots - busy_slots
        room_free_slots.update(free_slots)
        room_free_counts.append((room, len(free_slots)))
    if len(room_free_slots) < needed_blocks:
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
        mutually_free_slots -= teacher_busy_slots(teacher)
    if len(mutually_free_slots) < needed_blocks:
        return _reason(
            "Combined availability",
            f"No common free slots for {course.name} across its teacher, room, "
            "and semester.",
        )

    # KAN-52: enough free slots in total, but are there enough consecutive ones?
    def covered_from(day: int, slot: int) -> list[Slot]:
        return problem.covered_slots(course.id, day, slot)

    free_starts = [
        (day, slot) for day, slot in grid_starts
        if all(block in mutually_free_slots for block in covered_from(day, slot))
    ]
    if _fitting_sessions(problem, course, free_starts) < sessions:
        return _reason(
            "Session length",
            f"Not enough free periods of {blocks} consecutive slots for "
            f"{sessions} sessions of {course.name}.",
        )

    # Check whether the remaining candidate starts are blocked by room transitions.
    # Use the same buffer value as the ASP model and independent validator.
    buffer_slots = problem.buffer_slots

    if buffer_slots > 0 and solution is not None:
        other_group_blocks = [
            (day, slot, assignment.room_id)
            for assignment in assignments
            if assignment.course_id != course.id
            and assignment.course_id in courses_by_id
            and courses_by_id[assignment.course_id].semester_id == course.semester_id
            for day, slot in _covered(problem, assignment)
        ]

        def room_fits(room, day: int, start: int) -> bool:
            covered = covered_from(day, start)
            # The room must be free for every block of the session.
            if any(block in room_busy[room.id] for block in covered):
                return False
            # Another course of the same group in a different room must leave
            # the travel buffer before and after the session.
            first, last = covered[0][1], covered[-1][1]
            return not any(
                other_day == day
                and other_room != room.id
                and first - buffer_slots <= other_slot <= last + buffer_slots
                for other_day, other_slot, other_room in other_group_blocks
            )

        transition_starts = [
            (day, slot) for day, slot in free_starts
            if any(room_fits(room, day, slot) for room in eligible_rooms)
        ]
        if _fitting_sessions(problem, course, transition_starts) < sessions:
            return "Room transition: no slot leaves 15 minutes to change rooms."

    if solution is not None and solution.timed_out:
        return _reason("Scheduling timeout", "Scheduling timed out before this course could be placed.")
    return _reason("Scheduling constraint", f"No valid slot found for {course.name}.")
