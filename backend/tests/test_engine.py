"""KAN-15 pure Clingo hard-constraint and partial scheduling tests."""
import re
from types import SimpleNamespace

from app.engine.engine import solve
from app.engine.facts import Problem


def _one_block_sessions(facts):
    """Add the KAN-52 facts for courses written as course(C,H).

    These tests predate multi-block sessions: each course has H sessions of
    one block, and a session can start in any slot of the grid.
    """
    courses = re.findall(r"course\((\d+),(\d+)\)\.", facts)
    slots = re.findall(r"slot\((\d+),(\d+)\)\.", facts)
    extra = []
    for course_id, hours in courses:
        if f"sessions({course_id}," in facts:
            continue
        extra.append(f"sessions({course_id},{hours}). duration({course_id},1).")
        extra.extend(f"start_ok({course_id},{day},{slot})." for day, slot in slots)
    return facts + "\n" + "\n".join(extra)


def make_problem(facts, ids_hours, slots, rooms=(1,)):
    courses = [SimpleNamespace(id=i, semester_id=1, weekly_hours=h)
               for i, h in ids_hours]
    return Problem(courses=courses, rooms=list(rooms),
                   slots={(0, s): (None, None) for s in range(slots)},
                   facts=_one_block_sessions(facts), group_capacity={1: slots})


def make_block_problem(facts, courses, slots_per_day, days=1, rooms=(1,)):
    """Problem with explicit (course_id, sessions, blocks) for KAN-52 tests."""
    course_objects = [SimpleNamespace(id=i, semester_id=1, weekly_hours=n * b)
                      for i, n, b in courses]
    slot_map = {(d, s): (None, None) for d in range(days) for s in range(slots_per_day)}
    lines = [facts]
    lines.extend(f"slot({d},{s})." for d, s in slot_map)
    for course_id, sessions, blocks in courses:
        lines.append(f"course({course_id},{sessions * blocks}). "
                     f"sessions({course_id},{sessions}). duration({course_id},{blocks}).")
        lines.extend(f"start_ok({course_id},{d},{s})."
                     for d, s in slot_map if s + blocks <= slots_per_day)
    return Problem(
        courses=course_objects, rooms=list(rooms), slots=slot_map,
        facts="\n".join(lines), group_capacity={1: len(slot_map)},
        session_blocks={i: b for i, _, b in courses},
        sessions_per_week={i: n for i, n, _ in courses},
    )


def test_model_schedules_exact_blocks_and_eligible_rooms():
    facts = """
    course(1,2). course(2,1).
    students(1,80). students(2,20).
    requires_projector(1). requires_lab(2).
    room(1,100). has_projector(1).
    room(2,40). is_lab(2).
    group(1,1). group(2,1).
    slot(0,0). slot(0,1). slot(0,2).
    """
    result = solve(make_problem(facts, [(1,2),(2,1)], 3, rooms=(1,2)))
    assert result is not None
    assert len(result.assignments) == 3
    assert result.scheduled_ids == {1,2}
    assert {a.room_id for a in result.assignments if a.course_id == 1} == {1}
    assert {a.room_id for a in result.assignments if a.course_id == 2} == {2}
    assert len({(a.day,a.slot) for a in result.assignments}) == 3


def test_insufficient_group_slots_produces_complete_course_partial():
    facts = """
    course(1,2). course(2,2).
    students(1,20). students(2,20).
    room(1,100). group(1,1). group(2,1).
    slot(0,0). slot(0,1). slot(0,2).
    """
    result = solve(make_problem(facts, [(1,2),(2,2)], 3))
    assert result is not None
    assert len(result.scheduled_ids) == 1
    assert len(result.assignments) == 2


def test_fixed_room_reservation_is_respected():
    facts = """
    course(1,1). students(1,20). group(1,1).
    room(1,40). slot(0,0). slot(0,1).
    busy_room(1,0,0).
    """
    result = solve(make_problem(facts, [(1,1)], 2))
    assert result is not None
    assert len(result.assignments) == 1
    assert result.assignments[0].slot == 1


# KAN-53: Separate rooms require a free travel slot for the same student group.
def test_room_transition_blocks_back_to_back_different_rooms():
    facts = """
    course(1,1). course(2,1).
    students(1,20). students(2,20).
    group(1,1). group(2,1).
    room(1,40). is_lab(1).
    room(2,40). has_projector(2).
    requires_lab(1). requires_projector(2).
    slot(0,0). slot(0,1).
    buffer_slots(1).
    """
    result = solve(make_problem(facts, [(1,1), (2,1)], 2, rooms=(1,2)))

    # Both courses cannot be scheduled without an intervening free slot.
    assert result is not None
    assert len(result.scheduled_ids) == 1


# KAN-53: Consecutive classes in the same room require no travel buffer.
def test_room_transition_allows_back_to_back_same_room():
    facts = """
    course(1,1). course(2,1).
    students(1,20). students(2,20).
    group(1,1). group(2,1).
    room(1,40).
    slot(0,0). slot(0,1).
    buffer_slots(1).
    """
    result = solve(make_problem(facts, [(1,1), (2,1)], 2))

    assert result is not None
    assert result.scheduled_ids == {1,2}
    assert {a.slot for a in result.assignments} == {0,1}
    assert {a.room_id for a in result.assignments} == {1}


# KAN-53: One complete free slot permits a change between different rooms.
def test_room_transition_allows_gap_between_different_rooms():
    facts = """
    course(1,1). course(2,1).
    students(1,20). students(2,20).
    group(1,1). group(2,1).
    room(1,40). is_lab(1).
    room(2,40). has_projector(2).
    requires_lab(1). requires_projector(2).
    slot(0,0). slot(0,1). slot(0,2).
    buffer_slots(1).
    """
    result = solve(make_problem(facts, [(1,1), (2,1)], 3, rooms=(1,2)))

    assert result is not None
    assert result.scheduled_ids == {1,2}
    assert {a.room_id for a in result.assignments} == {1,2}

    slots = sorted(a.slot for a in result.assignments)
    assert slots == [0,2]


# KAN-53: Travel buffers apply only to the same student group.
def test_room_transition_allows_different_groups():
    facts = """
    course(1,1). course(2,1).
    students(1,20). students(2,20).
    group(1,1). group(2,2).
    room(1,40). is_lab(1).
    room(2,40). has_projector(2).
    requires_lab(1). requires_projector(2).
    slot(0,0). slot(0,1).
    buffer_slots(1).
    """
    result = solve(make_problem(facts, [(1,1), (2,1)], 2, rooms=(1,2)))

    assert result is not None
    assert result.scheduled_ids == {1, 2}


# KAN-53: Room transitions on separate days require no buffer.
def test_room_transition_allows_different_days():
    facts = """
    course(1,1). course(2,1).
    students(1,20). students(2,20).
    group(1,1). group(2,1).
    room(1,40). is_lab(1).
    room(2,40). has_projector(2).
    requires_lab(1). requires_projector(2).
    slot(0,0). slot(1,0).
    buffer_slots(1).
    """
    result = solve(make_problem(facts, [(1,1), (2,1)], 2, rooms=(1,2)))

    assert result is not None
    assert result.scheduled_ids == {1, 2}
    assert {a.day for a in result.assignments} == {0, 1}


# KAN-52: a 2-block course gets one session spanning two consecutive slots.
def test_two_block_course_gets_one_session_over_consecutive_slots():
    facts = "students(1,20). group(1,1). room(1,40)."
    result = solve(make_block_problem(facts, [(1, 1, 2)], slots_per_day=4))

    assert result is not None
    assert result.scheduled_ids == {1}
    assert len(result.assignments) == 1  # one session, not two 1-block entries
    assert result.assignments[0].slot <= 2  # slots S and S+1 both exist


# KAN-52: a 2-block course never starts in the last slot of the day.
def test_two_block_course_never_starts_in_last_slot():
    # Slots 0 and 1 are taken in the only room, so slot 2 (the last one)
    # would be the only free start: the course cannot be scheduled.
    facts = """
    students(1,20). group(1,1). room(1,40).
    busy_room(1,0,0). busy_room(1,0,1).
    """
    result = solve(make_block_problem(facts, [(1, 1, 2)], slots_per_day=3))

    assert result is not None
    assert result.scheduled_ids == set()
    assert result.assignments == []


# KAN-52: two sessions of the same course on the same day never overlap.
def test_sessions_of_same_course_do_not_overlap():
    facts = "students(1,20). group(1,1). room(1,40). room(2,40)."
    result = solve(make_block_problem(
        facts, [(1, 2, 2)], slots_per_day=4, rooms=(1, 2),
    ))

    assert result is not None
    assert result.scheduled_ids == {1}
    covered = [(a.day, a.slot + offset) for a in result.assignments for offset in (0, 1)]
    assert len(covered) == len(set(covered)) == 4


# KAN-52: a fixed reservation on the second block of a session also blocks it.
def test_busy_slot_blocks_every_block_of_a_session():
    facts = """
    students(1,20). group(1,1). room(1,40).
    busy_room(1,0,1).
    """
    result = solve(make_block_problem(facts, [(1, 1, 2)], slots_per_day=4))

    assert result is not None
    assert result.scheduled_ids == {1}
    assert result.assignments[0].slot == 2  # starting at 0 would cover slot 1


# KAN-52: group clashes are checked on every block, not only on start slots.
def test_group_clash_is_checked_on_every_block():
    facts = """
    students(1,20). students(2,20).
    group(1,1). group(2,1).
    room(1,40). room(2,40).
    """
    result = solve(make_block_problem(
        facts, [(1, 1, 2), (2, 1, 2)], slots_per_day=4, rooms=(1, 2),
    ))

    assert result is not None
    assert result.scheduled_ids == {1, 2}
    blocks = [(a.day, a.slot + offset) for a in result.assignments for offset in (0, 1)]
    assert len(set(blocks)) == 4


# KAN-52 + KAN-53: the travel buffer counts from the END of a multi-block session.
def test_room_transition_buffer_counts_from_end_of_session():
    facts = """
    students(1,20). students(2,20).
    group(1,1). group(2,1).
    room(1,40). is_lab(1). requires_lab(1).
    room(2,40). has_projector(2). requires_projector(2).
    buffer_slots(1).
    """
    # 2 + 1 (buffer) + 2 = 5 slots are needed; 4 are not enough.
    too_short = solve(make_block_problem(
        facts, [(1, 1, 2), (2, 1, 2)], slots_per_day=4, rooms=(1, 2),
    ))
    assert too_short is not None
    assert len(too_short.scheduled_ids) == 1

    enough = solve(make_block_problem(
        facts, [(1, 1, 2), (2, 1, 2)], slots_per_day=5, rooms=(1, 2),
    ))
    assert enough is not None
    assert enough.scheduled_ids == {1, 2}
    assert sorted(a.slot for a in enough.assignments) == [0, 3]
