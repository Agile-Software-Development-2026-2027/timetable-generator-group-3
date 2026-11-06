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
