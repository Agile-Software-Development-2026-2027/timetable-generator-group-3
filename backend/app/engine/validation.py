"""Independent validation of an ASP solution before replacing database rows."""
from __future__ import annotations

from collections import Counter

from app.engine.engine import Solution
from app.engine.facts import Problem


class InvalidScheduleError(ValueError):
    """Clingo returned an assignment that violates scheduling rules."""


def _check_session_fits(
    problem: Problem, course_id: int, covered: list[tuple[int, int]]
) -> None:
    """Every block of a session must exist and follow the previous one without a gap."""
    for index, slot in enumerate(covered):
        if slot not in problem.slots:
            raise InvalidScheduleError(
                f"Course {course_id}: slot {slot} of the session does not exist."
            )
        if index == 0:
            continue
        previous_end = problem.slots[covered[index - 1]][1]
        current_start = problem.slots[slot][0]
        if None not in (previous_end, current_start) and previous_end != current_start:
            raise InvalidScheduleError(
                f"Course {course_id}: the session crosses a gap in the grid at {slot}."
            )


class ConsecutiveWorkloadError(InvalidScheduleError):
    """A teacher's consecutive teaching limit was exceeded."""


def _check_teacher_workloads(
    problem: Problem,
    occupied_teachers: set[tuple[int, int, int]],
) -> None:
    """KAN-72: independently validate hard teacher workload limits.

    External teaching contributes to workload, but unavailable time does not.
    Existing external-only violations may remain when new assignments do
    not worsen them.
    """
    for teacher_id, workload in problem.teacher_workloads.items():
        new_slots = {
            (day, slot)
            for tid, day, slot in occupied_teachers
            if tid == teacher_id
        }

        if not new_slots:
            continue

        external_slots = {
            (day, slot)
            for tid, day, slot in problem.external_teaching
            if tid == teacher_id
        }

        all_slots = new_slots | external_slots

        # Maximum teaching hours per day.
        if workload.max_daily_slots is not None:
            external_counts = Counter(day for day, _ in external_slots)
            daily_counts = Counter(day for day, _ in all_slots)

            for day, count in sorted(daily_counts.items()):
                limit = max(
                    workload.max_daily_slots,
                    external_counts[day],
                )

                if count > limit:
                    raise InvalidScheduleError(
                        f"Teacher {teacher_id} exceeds the maximum daily "
                        f"teaching workload on day {day}: "
                        f"{count} slots, allowed {limit}."
                    )

        # Maximum distinct teaching days.
        if workload.max_teaching_days is not None:
            external_days = {day for day, _ in external_slots}
            teaching_days = {day for day, _ in all_slots}

            limit = max(
                workload.max_teaching_days,
                len(external_days),
            )

            if len(teaching_days) > limit:
                raise InvalidScheduleError(
                    f"Teacher {teacher_id} exceeds the maximum teaching "
                    f"days: {len(teaching_days)}, allowed {limit}."
                )

        # Maximum consecutive teaching hours.
        if workload.max_consecutive_slots is not None:
            previous: tuple[int, int] | None = None
            run_length = 0
            run_has_new = False

            for current in sorted(all_slots):
                day, slot = current

                contiguous = (
                    previous is not None
                    and previous[0] == day
                    and previous[1] + 1 == slot
                    and previous in problem.slots
                    and current in problem.slots
                    and problem.slots[previous][1]
                    == problem.slots[current][0]
                )

                if not contiguous:
                    run_length = 0
                    run_has_new = False

                run_length += 1
                run_has_new = run_has_new or current in new_slots

                if (
                    run_has_new
                    and run_length > workload.max_consecutive_slots
                ):
                    raise ConsecutiveWorkloadError(
                        f"Teacher {teacher_id} exceeds the maximum "
                        f"consecutive teaching workload on day {day}: "
                        f"{run_length} slots, allowed "
                        f"{workload.max_consecutive_slots}."
                    )

                previous = current


def validate_solution(problem: Problem, solution: Solution) -> None:
    """Check hours, eligibility, overlaps, reservations and teacher workloads.

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

    buffer_slots = problem.buffer_slots

    counts: Counter[int] = Counter()
    lengths: dict[int, list[int]] = {}
    group_day_assignments: dict[tuple[int, int], list[tuple[int, int]]] = {}
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
        if room.capacity < course.enrolled_students:
            raise InvalidScheduleError(f"Room capacity too small for course {course.id}.")
        if course.requires_lab and not room.is_lab:
            raise InvalidScheduleError(f"Course {course.id} requires a laboratory.")
        if course.requires_projector and not room.has_projector:
            raise InvalidScheduleError(f"Course {course.id} requires a projector.")

        # KAN-52: a session covers duration consecutive blocks from its start slot.
        covered = problem.covered_slots(course.id, a.day, a.slot, a.blocks)
        _check_session_fits(problem, course.id, covered)

        for day, slot in covered:
            course_slot = (course.id, day, slot)
            room_slot = (room.id, day, slot)
            group_slot = (course.semester_id, day, slot)
            if course_slot in occupied_course_slots:
                raise InvalidScheduleError(f"Course {course.id} has two sessions in one slot.")
            if room_slot in occupied_rooms or room_slot in problem.busy_rooms:
                raise InvalidScheduleError(f"Room {room.id} has conflicting sessions.")
            if group_slot in occupied_groups or group_slot in problem.busy_groups:
                raise InvalidScheduleError(
                    f"Student group {course.semester_id} has conflicting sessions."
                )
            teacher_slots = {(t.id, day, slot) for t in course.teachers}
            if teacher_slots & (occupied_teachers | problem.busy_teachers):
                raise InvalidScheduleError(f"Course {course.id} has a teacher conflict.")
            occupied_course_slots.add(course_slot)
            occupied_rooms.add(room_slot)
            occupied_groups.add(group_slot)
            occupied_teachers.update(teacher_slots)
            group_day_assignments.setdefault(
                (course.semester_id, day), []
            ).append((slot, room.id))
        counts[course.id] += 1
        lengths.setdefault(course.id, []).append(len(covered))

    # KAN-72: independently verify teacher workload constraints.
    _check_teacher_workloads(problem, occupied_teachers)

    # Different rooms require enough intervening slots for the room transition.
    for (semester_id, day), group_assignments in group_day_assignments.items():
        ordered = sorted(group_assignments)
        for index, (first_slot, first_room) in enumerate(ordered):
            for second_slot, second_room in ordered[index + 1:]:
                if (
                    first_room != second_room
                    and second_slot - first_slot <= buffer_slots
                ):
                    raise InvalidScheduleError(
                        f"Student group {semester_id} violates the room-transition "
                        f"buffer on day {day} between slots {first_slot} and {second_slot}."
                    )

    for course in problem.courses:
        expected = problem.sessions_of(course) if course.id in solution.scheduled_ids else 0
        if counts[course.id] != expected:
            raise InvalidScheduleError(
                f"Course {course.id}: expected {expected} sessions, got {counts[course.id]}."
            )
        # KAN-78: the sessions must have the lengths the course asks for.
        if expected and sorted(lengths[course.id]) != sorted(problem.session_lengths(course)):
            raise InvalidScheduleError(
                f"Course {course.id}: sessions of {sorted(lengths[course.id])} blocks, "
                f"expected {sorted(problem.session_lengths(course))}."
            )
