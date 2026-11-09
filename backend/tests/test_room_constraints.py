"""KAN-16 room constraint tests: capacity, lab, projector hard constraints
and smallest-room soft preference in the ASP engine."""
from __future__ import annotations

from datetime import time
from types import SimpleNamespace

from app.engine.facts import Problem
from app.engine.reasons import unscheduled_course_reason
from app.models import Course, Degree, Room, Semester, Year


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_course(session, *, degree, year, semester, **kwargs):
    defaults = dict(
        name="Test Course",
        weekly_hours=1,
        enrolled_students=30,
        requires_lab=False,
        requires_projector=False,
    )
    defaults.update(kwargs)
    c = Course(
        degree_id=degree.id,
        year_id=year.id,
        semester_id=semester.id,
        **defaults,
    )
    session.add(c)
    session.commit()
    return c


def _degree_and_semester(session, name="Test Degree"):
    semester = Semester(number=1)
    year = Year(number=1, semesters=[semester])
    degree = Degree(name=name, years=[year])
    session.add(degree)
    session.flush()
    session.commit()
    return degree, year, semester


# ---------------------------------------------------------------------------
# Hard constraint: capacity
# ---------------------------------------------------------------------------

class TestCapacityConstraint:
    def test_room_too_small_returns_infeasible(self, client, session):
        degree, year, sem = _degree_and_semester(session)
        _make_course(session, degree=degree, year=year, semester=sem,
                     enrolled_students=50)
        small = Room(code="SMALL", capacity=30)
        session.add(small)
        session.commit()

        result = client.post("/timetable/generate", json={"degree_id": degree.id})
        assert result.status_code == 200
        body = result.json()
        assert body["status"] == "infeasible"
        assert body["sessions_created"] == 0
        assert "Room capacity" in body["unscheduled"][0]["reason"]
        assert "30" in body["unscheduled"][0]["reason"]  # shows the too-small room

    def test_exact_capacity_room_is_accepted(self, client, session):
        degree, year, sem = _degree_and_semester(session)
        _make_course(session, degree=degree, year=year, semester=sem,
                     enrolled_students=30)
        exact = Room(code="EXACT", capacity=30)
        session.add(exact)
        session.commit()

        result = client.post("/timetable/generate", json={"degree_id": degree.id})
        assert result.status_code == 200
        assert result.json()["status"] == "ok"

    def test_oversized_room_is_accepted(self, client, session):
        degree, year, sem = _degree_and_semester(session)
        _make_course(session, degree=degree, year=year, semester=sem,
                     enrolled_students=30)
        big = Room(code="BIG", capacity=200)
        session.add(big)
        session.commit()

        result = client.post("/timetable/generate", json={"degree_id": degree.id})
        assert result.status_code == 200
        assert result.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# Hard constraint: lab requirement
# ---------------------------------------------------------------------------

class TestLabConstraint:
    def test_non_lab_room_rejected_for_lab_course(self, client, session):
        degree, year, sem = _degree_and_semester(session)
        _make_course(session, degree=degree, year=year, semester=sem,
                     enrolled_students=20, requires_lab=True)
        session.add(Room(code="LEC", capacity=100, is_lab=False))
        session.commit()

        result = client.post("/timetable/generate", json={"degree_id": degree.id})
        assert result.status_code == 200
        body = result.json()
        assert body["status"] == "infeasible"
        reason = body["unscheduled"][0]["reason"]
        assert "Lab" in reason or "lab" in reason

    def test_lab_room_accepted_for_lab_course(self, client, session):
        degree, year, sem = _degree_and_semester(session)
        _make_course(session, degree=degree, year=year, semester=sem,
                     enrolled_students=20, requires_lab=True)
        session.add(Room(code="LAB1", capacity=40, is_lab=True))
        session.commit()

        result = client.post("/timetable/generate", json={"degree_id": degree.id})
        assert result.status_code == 200
        assert result.json()["status"] == "ok"

    def test_lab_room_not_required_when_course_has_no_lab_flag(self, client, session):
        degree, year, sem = _degree_and_semester(session)
        _make_course(session, degree=degree, year=year, semester=sem,
                     enrolled_students=20, requires_lab=False)
        # Only a non-lab room available — should still be OK
        session.add(Room(code="LEC", capacity=40, is_lab=False))
        session.commit()

        result = client.post("/timetable/generate", json={"degree_id": degree.id})
        assert result.status_code == 200
        assert result.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# Hard constraint: projector requirement
# ---------------------------------------------------------------------------

class TestProjectorConstraint:
    def test_no_projector_room_rejected_for_projector_course(self, client, session):
        degree, year, sem = _degree_and_semester(session)
        _make_course(session, degree=degree, year=year, semester=sem,
                     enrolled_students=20, requires_projector=True)
        session.add(Room(code="PLAIN", capacity=50, has_projector=False))
        session.commit()

        result = client.post("/timetable/generate", json={"degree_id": degree.id})
        assert result.status_code == 200
        body = result.json()
        assert body["status"] == "infeasible"
        reason = body["unscheduled"][0]["reason"]
        assert "projector" in reason.lower()

    def test_projector_room_accepted_for_projector_course(self, client, session):
        degree, year, sem = _degree_and_semester(session)
        _make_course(session, degree=degree, year=year, semester=sem,
                     enrolled_students=20, requires_projector=True)
        session.add(Room(code="PROJ", capacity=50, has_projector=True))
        session.commit()

        result = client.post("/timetable/generate", json={"degree_id": degree.id})
        assert result.status_code == 200
        assert result.json()["status"] == "ok"

    def test_lab_and_projector_both_required(self, client, session):
        degree, year, sem = _degree_and_semester(session)
        _make_course(session, degree=degree, year=year, semester=sem,
                     enrolled_students=20, requires_lab=True, requires_projector=True)
        # Room that is a lab but has no projector
        session.add(Room(code="LAB-NOPROJ", capacity=50,
                         is_lab=True, has_projector=False))
        session.commit()

        result = client.post("/timetable/generate", json={"degree_id": degree.id})
        body = result.json()
        assert body["status"] == "infeasible"
        # Room that satisfies both
        session.add(Room(code="LAB-PROJ", capacity=50,
                         is_lab=True, has_projector=True))
        session.commit()

        result2 = client.post("/timetable/generate", json={"degree_id": degree.id})
        assert result2.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# Soft preference: smallest fitting room
# ---------------------------------------------------------------------------

class TestSmallestRoomPreference:
    def test_smallest_eligible_room_is_preferred(self, client, session):
        """Given multiple fitting rooms, the engine should assign the smallest one."""
        degree, year, sem = _degree_and_semester(session)
        _make_course(session, degree=degree, year=year, semester=sem,
                     enrolled_students=30, weekly_hours=1)
        # Add rooms from largest to smallest so insertion order is not the reason
        session.add(Room(code="HUGE", capacity=500))
        session.add(Room(code="MEDIUM", capacity=100))
        session.add(Room(code="TIGHT", capacity=30))   # smallest that fits exactly
        session.commit()

        result = client.post("/timetable/generate", json={"degree_id": degree.id})
        assert result.status_code == 200
        body = result.json()
        assert body["status"] == "ok"
        sessions = client.get("/timetable/sessions").json()
        assert len(sessions) == 1
        # The assigned room should be the tightest fit (30-seat), not the 500-seat
        assert sessions[0]["room_code"] == "TIGHT"

    def test_smallest_lab_is_preferred_for_lab_course(self, client, session):
        """For a lab course, the smallest eligible lab should be preferred."""
        degree, year, sem = _degree_and_semester(session)
        _make_course(session, degree=degree, year=year, semester=sem,
                     enrolled_students=20, requires_lab=True, weekly_hours=1)
        # A large non-lab (ineligible) and two labs of different sizes
        session.add(Room(code="BIG-LEC", capacity=500, is_lab=False))
        session.add(Room(code="BIG-LAB", capacity=200, is_lab=True))
        session.add(Room(code="SMALL-LAB", capacity=25, is_lab=True))  # snug fit
        session.commit()

        result = client.post("/timetable/generate", json={"degree_id": degree.id})
        assert result.status_code == 200
        assert result.json()["status"] == "ok"
        sessions = client.get("/timetable/sessions").json()
        assert sessions[0]["room_code"] == "SMALL-LAB"


# ---------------------------------------------------------------------------
# Unscheduled reason: "No suitable room available"
# ---------------------------------------------------------------------------

class TestNoSuitableRoomReason:
    """Unit-level checks that the reasons module returns the expected strings
    when no eligible room exists for a course."""

    def _make_problem(self, rooms, course):
        return Problem(
            courses=[course],
            rooms=rooms,
            slots={(0, 0): (time(9), time(10))},
            facts="",
            group_capacity={course.semester_id: 1},
        )

    def test_reason_no_rooms_at_all(self):
        course = SimpleNamespace(
            id=1, name="Maths", semester_id=1, weekly_hours=1,
            enrolled_students=30, requires_lab=False, requires_projector=False,
            teachers=[],
        )
        problem = Problem(
            courses=[course], rooms=[],
            slots={(0, 0): (time(9), time(10))},
            facts="", group_capacity={1: 1},
        )
        reason = unscheduled_course_reason(problem, course, None)
        assert reason == "Room availability: No rooms are configured for this timetable."

    def test_reason_capacity_mismatch(self):
        course = SimpleNamespace(
            id=1, name="Maths", semester_id=1, weekly_hours=1,
            enrolled_students=80, requires_lab=False, requires_projector=False,
            teachers=[],
        )
        rooms = [
            SimpleNamespace(id=1, code="TINY", capacity=10,
                            is_lab=False, has_projector=False),
        ]
        problem = self._make_problem(rooms, course)
        reason = unscheduled_course_reason(problem, course, None)
        assert reason.startswith("Room capacity:")
        assert "80" in reason

    def test_reason_lab_required_no_labs(self):
        course = SimpleNamespace(
            id=1, name="Physics Lab", semester_id=1, weekly_hours=1,
            enrolled_students=20, requires_lab=True, requires_projector=False,
            teachers=[],
        )
        rooms = [
            SimpleNamespace(id=1, code="LEC", capacity=100,
                            is_lab=False, has_projector=False),
        ]
        problem = self._make_problem(rooms, course)
        reason = unscheduled_course_reason(problem, course, None)
        assert "Lab capacity" in reason
        assert "No lab room is configured" in reason

    def test_reason_lab_required_too_small(self):
        course = SimpleNamespace(
            id=1, name="Physics Lab", semester_id=1, weekly_hours=1,
            enrolled_students=60, requires_lab=True, requires_projector=False,
            teachers=[],
        )
        rooms = [
            SimpleNamespace(id=1, code="SMALL-LAB", capacity=30,
                            is_lab=True, has_projector=False),
        ]
        problem = self._make_problem(rooms, course)
        reason = unscheduled_course_reason(problem, course, None)
        assert "Lab capacity" in reason
        assert "60" in reason
        assert "SMALL-LAB" in reason

    def test_reason_projector_required_none_available(self):
        course = SimpleNamespace(
            id=1, name="Multimedia", semester_id=1, weekly_hours=1,
            enrolled_students=20, requires_lab=False, requires_projector=True,
            teachers=[],
        )
        rooms = [
            SimpleNamespace(id=1, code="PLAIN", capacity=50,
                            is_lab=False, has_projector=False),
        ]
        problem = self._make_problem(rooms, course)
        reason = unscheduled_course_reason(problem, course, None)
        assert "Room equipment" in reason
        assert "projector" in reason.lower()

    def test_reason_fallback_no_suitable_room(self):
        """The generic fallback must say 'No suitable room available'."""
        from app.engine.reasons import _room_constraint_reason
        course = SimpleNamespace(
            id=1, name="Any", semester_id=1, weekly_hours=1,
            enrolled_students=20, requires_lab=False, requires_projector=False,
            teachers=[],
        )
        # Provide a room that passes all individual checks so we reach the fallback
        rooms = [
            SimpleNamespace(id=1, code="OK", capacity=30,
                            is_lab=False, has_projector=True),
        ]
        reason = _room_constraint_reason(course, rooms)
        assert "No suitable room available" in reason
