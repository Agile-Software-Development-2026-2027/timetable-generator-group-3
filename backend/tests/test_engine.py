"""KAN-15 pure Clingo hard-constraint and partial scheduling tests."""
from app.engine.engine import solve
from app.engine.facts import Problem


def make_problem(facts, ids_hours, slots, rooms=(1,)):
    from types import SimpleNamespace
    courses = [SimpleNamespace(id=i, semester_id=1, weekly_hours=h)
               for i, h in ids_hours]
    return Problem(courses=courses, rooms=list(rooms),
                   slots={(0, s): (None, None) for s in range(slots)},
                   facts=facts, group_capacity={1: slots})


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
