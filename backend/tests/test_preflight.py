"""KAN-67: preflight validation without invoking the ASP solver."""

from datetime import time
from types import SimpleNamespace

import pytest

from app.engine.facts import Problem, TeacherWorkload
from app.engine.preflight import check_preflight
from app.models import Room, ScheduleSession, Teacher


@pytest.fixture
def problem():
    teacher = SimpleNamespace(id=1, name="Test Teacher")

    course = SimpleNamespace(
        id=1,
        name="Databases",
        semester_id=1,
        weekly_hours=2,
        session_duration_minutes=60,
        enrolled_students=30,
        requires_lab=False,
        requires_projector=False,
        teachers=[teacher],
    )

    room = SimpleNamespace(
        id=1,
        code="ROOM-1",
        capacity=50,
        is_lab=False,
        has_projector=True,
    )

    slots = {
        (day, slot): (
            time(9 + slot),
            time(10 + slot),
        )
        for day in range(5)
        for slot in range(4)
    }

    return Problem(
        courses=[course],
        rooms=[room],
        slots=slots,
        facts="",
        group_capacity={1: len(slots)},
        block_minutes=60,
    )


def find_warning(problem, kind):
    matches = [
        item for item in check_preflight(problem)
        if item.type == kind
    ]
    assert len(matches) == 1
    return matches[0]


def test_clean_dataset(problem):
    assert check_preflight(problem) == []


def test_missing_teacher(problem):
    problem.courses[0].teachers = []

    warning = find_warning(problem, "missing_teacher")

    assert warning.severity == "warning"
    assert warning.course_id == 1


def test_insufficient_room_capacity(problem):
    problem.courses[0].enrolled_students = 100

    warning = find_warning(problem, "room_capacity")

    assert warning.severity == "error"
    assert warning.course_id == 1


def test_missing_laboratory(problem):
    problem.courses[0].requires_lab = True

    warning = find_warning(problem, "missing_lab")

    assert warning.severity == "error"
    assert warning.course_id == 1


def test_missing_projector(problem):
    problem.courses[0].requires_projector = True
    problem.rooms[0].has_projector = False

    warning = find_warning(problem, "missing_projector")

    assert warning.severity == "error"
    assert warning.course_id == 1


def test_semester_capacity_exceeded(problem):
    problem.courses[0].weekly_hours = 21

    warning = find_warning(problem, "semester_capacity")

    assert warning.severity == "error"
    assert warning.course_id == 1


def test_teacher_has_no_available_slots(problem):
    problem.busy_teachers = {
        (1, day, slot)
        for day, slot in problem.slots
    }

    warning = find_warning(problem, "teacher_unavailable")

    assert warning.severity == "error"
    assert warning.teacher_id == 1


def test_teacher_workload_exceeded(problem):
    problem.courses[0].weekly_hours = 6

    problem.teacher_workloads[1] = TeacherWorkload(
        max_daily_slots=1,
        max_teaching_days=5,
    )

    warning = find_warning(problem, "teacher_workload")

    assert warning.severity == "error"
    assert warning.teacher_id == 1


def test_combined_room_requirements(problem):
    problem.courses[0].requires_lab = True
    problem.courses[0].requires_projector = True

    problem.rooms.append(
        SimpleNamespace(
            id=2,
            code="LAB-1",
            capacity=50,
            is_lab=True,
            has_projector=False,
        )
    )

    warning = find_warning(problem, "room_suitability")

    assert warning.severity == "error"
    assert warning.course_id == 1


def test_multiple_problems_are_reported(problem):
    course = problem.courses[0]
    course.teachers = []
    course.enrolled_students = 100
    course.requires_lab = True
    course.requires_projector = True

    problem.rooms[0].has_projector = False

    warnings = check_preflight(problem)

    assert {item.type for item in warnings} == {
        "missing_teacher",
        "room_capacity",
        "missing_lab",
        "missing_projector",
    }


@pytest.fixture
def preflight_client(auth_client, session, course):
    teacher = Teacher(
        name="Preflight Teacher",
        identifier="preflight-teacher",
    )

    course.teachers.append(teacher)

    session.add(
        Room(
            code="PREFLIGHT-ROOM",
            capacity=120,
            is_lab=True,
            has_projector=True,
        )
    )
    session.commit()

    return auth_client("director")


def test_preflight_api_clean_dataset(preflight_client, course):
    response = preflight_client.get(
        f"/timetable/preflight?degree_id={course.degree_id}"
    )

    assert response.status_code == 200
    assert response.json() == {"warnings": []}


def test_preflight_api_returns_warnings(
    preflight_client, session, course,
):
    course.teachers.clear()
    course.enrolled_students = 200
    session.commit()

    response = preflight_client.get(
        f"/timetable/preflight?degree_id={course.degree_id}"
    )

    assert response.status_code == 200

    warnings = response.json()["warnings"]
    by_type = {item["type"]: item for item in warnings}

    assert by_type["missing_teacher"]["severity"] == "warning"
    assert by_type["room_capacity"]["severity"] == "error"
    assert by_type["missing_teacher"]["course_id"] == course.id
    assert by_type["room_capacity"]["course_id"] == course.id
    assert "teacher_id" not in by_type["room_capacity"]


def test_preflight_api_missing_degree(preflight_client):
    response = preflight_client.get(
        "/timetable/preflight?degree_id=999999"
    )

    assert response.status_code == 404


@pytest.mark.parametrize(
    "query",
    ["", "?degree_id=0", "?degree_id=-1", "?degree_id=abc"],
)
def test_preflight_api_invalid_degree(preflight_client, query):
    response = preflight_client.get(
        f"/timetable/preflight{query}"
    )

    assert response.status_code == 422


def test_preflight_api_requires_authentication(client, course):
    response = client.get(
        f"/timetable/preflight?degree_id={course.degree_id}"
    )

    assert response.status_code == 401


@pytest.mark.parametrize("role", ["teacher", "student"])
def test_preflight_api_requires_director(auth_client, course, role):
    user_client = auth_client(role)

    response = user_client.get(
        f"/timetable/preflight?degree_id={course.degree_id}"
    )

    assert response.status_code == 403


def test_preflight_api_does_not_invoke_solver(
    preflight_client, course, monkeypatch,
):
    def forbidden_solver(*args, **kwargs):
        pytest.fail("Preflight must not invoke the ASP solver.")

    monkeypatch.setattr(
        "app.timetable_generate.solve",
        forbidden_solver,
    )

    response = preflight_client.get(
        f"/timetable/preflight?degree_id={course.degree_id}"
    )

    assert response.status_code == 200


def test_preflight_api_preserves_existing_sessions(
    preflight_client, session, course,
):
    existing = ScheduleSession(
        course_id=course.id,
        weekday=0,
        start_time=time(9),
        end_time=time(10),
    )

    session.add(existing)
    session.commit()

    existing_id = existing.id

    response = preflight_client.get(
        f"/timetable/preflight?degree_id={course.degree_id}"
    )

    assert response.status_code == 200

    session.expire_all()

    saved = session.get(ScheduleSession, existing_id)

    assert saved is not None
    assert saved.course_id == course.id
    assert saved.start_time == time(9)
    assert saved.end_time == time(10)


def test_combined_teacher_weekly_workload(problem):
    first = problem.courses[0]
    first.weekly_hours = 3

    second = SimpleNamespace(
        **{
            **vars(first),
            "id": 2,
            "name": "Software Engineering",
            "semester_id": 2,
        }
    )

    problem.courses.append(second)

    problem.teacher_workloads[1] = TeacherWorkload(
        max_daily_slots=1,
    )

    warning = find_warning(problem, "teacher_workload")

    assert warning.severity == "error"
    assert warning.teacher_id == 1


def test_workload_respects_maximum_teaching_days(problem):
    problem.courses[0].weekly_hours = 5

    problem.teacher_workloads[1] = TeacherWorkload(
        max_teaching_days=1,
    )

    warning = find_warning(problem, "teacher_workload")

    assert warning.severity == "error"
    assert warning.teacher_id == 1


def test_workload_accounts_for_external_teaching(problem):
    problem.courses[0].weekly_hours = 5

    problem.teacher_workloads[1] = TeacherWorkload(
        max_daily_slots=1,
    )

    problem.external_teaching = {(1, 0, 0)}
    problem.busy_teachers = {(1, 0, 0)}

    warning = find_warning(problem, "teacher_workload")

    assert warning.severity == "error"
    assert warning.teacher_id == 1


def test_existing_external_violation_is_not_worsened(problem):
    problem.courses[0].weekly_hours = 1

    problem.teacher_workloads[1] = TeacherWorkload(
        max_daily_slots=1,
    )

    problem.external_teaching = {
        (1, 0, 0),
        (1, 0, 1),
    }
    problem.busy_teachers = set(problem.external_teaching)

    assert check_preflight(problem) == []


def test_multiple_teachers_correct_workload_attribution(problem):
    course = problem.courses[0]

    course.teachers.append(
        SimpleNamespace(id=2, name="Second Teacher")
    )

    problem.session_parts[course.id] = [2]

    problem.teacher_workloads[2] = TeacherWorkload(
        max_consecutive_slots=1,
    )

    warning = find_warning(problem, "teacher_workload")

    assert warning.severity == "error"
    assert warning.teacher_id == 2


def test_workload_at_exact_limit_is_allowed(problem):
    problem.courses[0].weekly_hours = 5

    problem.teacher_workloads[1] = TeacherWorkload(
        max_daily_slots=1,
        max_teaching_days=5,
    )

    assert check_preflight(problem) == []


def test_semester_capacity_uses_actual_session_blocks(problem):
    course = problem.courses[0]

    problem.session_parts[course.id] = [11, 10]

    warning = find_warning(problem, "semester_capacity")

    assert warning.severity == "error"
    assert warning.course_id == course.id


def test_preflight_api_response_time(preflight_client, course):
    from time import perf_counter

    url = f"/timetable/preflight?degree_id={course.degree_id}"

    warmup = preflight_client.get(url)
    assert warmup.status_code == 200

    durations = []

    for _ in range(10):
        start = perf_counter()
        response = preflight_client.get(url)
        elapsed = perf_counter() - start

        assert response.status_code == 200
        durations.append(elapsed)

    average = sum(durations) / len(durations)
    maximum = max(durations)

    print(f"\nRequests: {len(durations)}")
    print(f"Average response: {average * 1000:.2f} ms")
    print(f"Maximum response: {maximum * 1000:.2f} ms")

    assert maximum < 1.0, (
        f"Preflight exceeded 1 second: {maximum:.3f}s"
    )


def test_preflight_sample_dataset_performance(auth_client, session):
    import json
    from time import perf_counter

    from sqlalchemy import select

    from app.models import Degree
    from app.seed.seed_sample_data import DATA_DIR, load_dataset, validate

    # Reuse the repository's real sample dataset.
    with (DATA_DIR / "ai_cs.json").open(encoding="utf-8") as file:
        data = json.load(file)

    validate(data)

    # Uses the isolated SQLite test session, not Supabase.
    load_dataset(session, data)
    session.commit()

    degree = session.scalar(
        select(Degree).where(
            Degree.name == data["degree"]["name"]
        )
    )

    assert degree is not None

    director = auth_client("director")
    url = f"/timetable/preflight?degree_id={degree.id}"

    durations = []

    for _ in range(10):
        start = perf_counter()
        response = director.get(url)
        elapsed = perf_counter() - start

        assert response.status_code == 200
        assert isinstance(response.json()["warnings"], list)

        durations.append(elapsed)

    average = sum(durations) / len(durations)
    maximum = max(durations)

    print(f"\nDataset: {data['degree']['name']}")
    print(f"Courses: {len(data['courses'])}")
    print(f"Teachers: {len(data['teachers'])}")
    print(f"Rooms: {len(data['rooms'])}")
    print(f"Requests: {len(durations)}")
    print(f"Average response: {average * 1000:.2f} ms")
    print(f"Maximum response: {maximum * 1000:.2f} ms")
    print(f"Warnings: {len(response.json()['warnings'])}")

    assert maximum < 1.0, (
        f"Sample dataset exceeded 1 second: {maximum:.3f}s"
    )
