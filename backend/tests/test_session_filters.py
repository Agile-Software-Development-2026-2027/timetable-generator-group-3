from datetime import time

import pytest

from app.models import Course, Degree, Room, ScheduleSession, Semester, Teacher, Year


@pytest.fixture()
def timetable(session):
    """Two degrees, three years, four courses, three teachers, two rooms, five sessions."""
    cs_y1_s1, cs_y1_s2, cs_y2_s1, math_y1_s1 = (Semester(number=n) for n in (1, 2, 1, 1))
    cs_y1 = Year(number=1, semesters=[cs_y1_s1, cs_y1_s2])
    cs_y2 = Year(number=2, semesters=[cs_y2_s1])
    math_y1 = Year(number=1, semesters=[math_y1_s1])
    cs = Degree(name="Computer Science", years=[cs_y1, cs_y2])
    math = Degree(name="Mathematics", years=[math_y1])
    ada = Teacher(name="Ada Lovelace", identifier="T001")
    turing = Teacher(name="Alan Turing", identifier="T002")
    noether = Teacher(name="Emmy Noether", identifier="T003")
    mt1 = Room(code="MT1", capacity=110)
    lab = Room(code="LAB-A", capacity=30, has_computers=True, is_lab=True)
    session.add_all([cs, math, ada, turing, noether, mt1, lab])
    session.flush()

    def course(name, degree, year, semester, teachers):
        record = Course(
            name=name,
            degree_id=degree.id,
            year_id=year.id,
            semester_id=semester.id,
            weekly_hours=4,
            enrolled_students=60,
            teachers=teachers,
        )
        session.add(record)
        return record

    databases = course("Databases", cs, cs_y1, cs_y1_s1, [turing, ada])
    networks = course("Networks", cs, cs_y1, cs_y1_s2, [turing])
    compilers = course("Compilers", cs, cs_y2, cs_y2_s1, [])
    algebra = course("Algebra", math, math_y1, math_y1_s1, [noether])
    session.flush()

    def scheduled(course_record, room, weekday, start, end):
        record = ScheduleSession(
            course_id=course_record.id,
            room_id=room.id if room else None,
            weekday=weekday,
            start_time=time(start),
            end_time=time(end),
        )
        session.add(record)
        session.flush()
        return record.id

    sessions = {
        "db_mon": scheduled(databases, mt1, 0, 9, 11),
        "db_wed": scheduled(databases, None, 2, 9, 11),
        "net_mon": scheduled(networks, lab, 0, 11, 13),
        "comp_tue": scheduled(compilers, mt1, 1, 14, 16),
        "alg_mon": scheduled(algebra, lab, 0, 9, 11),
    }
    session.commit()
    return {
        "sessions": sessions,
        "degree_id": {"cs": cs.id, "math": math.id},
        "year_id": {"cs_y1": cs_y1.id, "cs_y2": cs_y2.id},
        "semester_id": {"cs_y1_s1": cs_y1_s1.id, "cs_y1_s2": cs_y1_s2.id},
        "teacher_id": {"ada": ada.id, "turing": turing.id, "noether": noether.id},
        "room_id": {"mt1": mt1.id, "lab": lab.id},
        "course_id": {"compilers": compilers.id},
    }


def labels(timetable, items):
    by_id = {session_id: label for label, session_id in timetable["sessions"].items()}
    return [by_id[item["id"]] for item in items]


# Weekday first, then start time, then id: the order the endpoint always returns.
ALL_IN_ORDER = ["db_mon", "alg_mon", "net_mon", "comp_tue", "db_wed"]


# --- No filters: existing behaviour preserved ---------------------------------


def test_without_filters_returns_every_session_in_a_stable_order(client, timetable):
    response = client.get("/timetable/sessions")

    assert response.status_code == 200
    assert labels(timetable, response.json()) == ALL_IN_ORDER
    assert response.headers["X-Total-Count"] == "5"


def test_response_is_still_a_plain_list_of_sessions(client, timetable):
    items = client.get("/timetable/sessions").json()

    assert isinstance(items, list)
    for field in ("id", "course_id", "room_id", "weekday", "start_time", "end_time"):
        assert field in items[0]


# --- Denormalised fields ------------------------------------------------------


def test_sessions_are_enriched_with_names(client, timetable):
    item = client.get("/timetable/sessions").json()[0]

    assert item == {
        "id": timetable["sessions"]["db_mon"],
        "course_id": item["course_id"],
        "room_id": timetable["room_id"]["mt1"],
        "weekday": 0,
        "start_time": "09:00:00",
        "end_time": "11:00:00",
        "course_name": "Databases",
        "degree_name": "Computer Science",
        "room_code": "MT1",
        "teacher_names": ["Ada Lovelace", "Alan Turing"],
    }


def test_session_without_a_room_has_no_room_code(client, timetable):
    items = client.get("/timetable/sessions?weekday=2").json()

    assert [(item["room_id"], item["room_code"]) for item in items] == [(None, None)]


def test_course_without_teachers_has_an_empty_teacher_list(client, timetable):
    items = client.get("/timetable/sessions?weekday=1").json()

    assert [item["teacher_names"] for item in items] == [[]]


def test_teacher_names_follow_course_teacher_assignments(client, timetable):
    compilers = timetable["course_id"]["compilers"]
    teachers = timetable["teacher_id"]

    assigned = client.put(
        f"/courses/{compilers}/teachers",
        json={"teacher_ids": [teachers["noether"], teachers["ada"]]},
    )

    assert assigned.status_code == 200
    items = client.get("/timetable/sessions?weekday=1").json()
    assert items[0]["teacher_names"] == ["Ada Lovelace", "Emmy Noether"]


# --- Filters ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("parameter", "value", "expected"),
    [
        ("degree_id", "cs", ["db_mon", "net_mon", "comp_tue", "db_wed"]),
        ("degree_id", "math", ["alg_mon"]),
        ("year_id", "cs_y1", ["db_mon", "net_mon", "db_wed"]),
        ("year_id", "cs_y2", ["comp_tue"]),
        ("semester_id", "cs_y1_s1", ["db_mon", "db_wed"]),
        ("semester_id", "cs_y1_s2", ["net_mon"]),
        ("teacher_id", "turing", ["db_mon", "net_mon", "db_wed"]),
        ("teacher_id", "ada", ["db_mon", "db_wed"]),
        ("teacher_id", "noether", ["alg_mon"]),
        ("room_id", "mt1", ["db_mon", "comp_tue"]),
        ("room_id", "lab", ["alg_mon", "net_mon"]),
        ("weekday", 0, ["db_mon", "alg_mon", "net_mon"]),
        ("weekday", 2, ["db_wed"]),
        ("weekday", 6, []),
    ],
)
def test_each_filter_narrows_the_sessions(client, timetable, parameter, value, expected):
    if parameter != "weekday":
        value = timetable[parameter][value]

    response = client.get(f"/timetable/sessions?{parameter}={value}")

    assert response.status_code == 200
    assert labels(timetable, response.json()) == expected
    assert response.headers["X-Total-Count"] == str(len(expected))


def test_teacher_filter_lists_a_shared_course_once(client, timetable):
    turing = timetable["teacher_id"]["turing"]

    items = client.get(f"/timetable/sessions?teacher_id={turing}").json()

    assert len(items) == len({item["id"] for item in items})


def test_filters_combine(client, timetable):
    cs = timetable["degree_id"]["cs"]
    turing = timetable["teacher_id"]["turing"]
    mt1 = timetable["room_id"]["mt1"]

    monday_cs = client.get(f"/timetable/sessions?degree_id={cs}&weekday=0").json()
    turing_in_mt1 = client.get(f"/timetable/sessions?teacher_id={turing}&room_id={mt1}").json()

    assert labels(timetable, monday_cs) == ["db_mon", "net_mon"]
    assert labels(timetable, turing_in_mt1) == ["db_mon"]


@pytest.mark.parametrize(
    "parameter", ["degree_id", "year_id", "semester_id", "teacher_id", "room_id"]
)
def test_unknown_ids_match_nothing(client, timetable, parameter):
    response = client.get(f"/timetable/sessions?{parameter}=9999")

    assert response.status_code == 200
    assert response.json() == []
    assert response.headers["X-Total-Count"] == "0"


@pytest.mark.parametrize(
    "query", ["weekday=7", "weekday=-1", "degree_id=abc", "teacher_id=1.5"]
)
def test_invalid_filter_values_are_rejected(client, timetable, query):
    assert client.get(f"/timetable/sessions?{query}").status_code == 422


# --- Pagination ---------------------------------------------------------------


def test_pages_split_the_ordered_sessions(client, timetable):
    pages = [
        client.get(f"/timetable/sessions?page={page}&page_size=2") for page in (1, 2, 3, 4)
    ]

    assert [labels(timetable, page.json()) for page in pages] == [
        ["db_mon", "alg_mon"],
        ["net_mon", "comp_tue"],
        ["db_wed"],
        [],
    ]
    assert {page.headers["X-Total-Count"] for page in pages} == {"5"}


def test_pagination_applies_after_filtering(client, timetable):
    cs = timetable["degree_id"]["cs"]

    response = client.get(f"/timetable/sessions?degree_id={cs}&page=2&page_size=3")

    assert labels(timetable, response.json()) == ["db_wed"]
    assert response.headers["X-Total-Count"] == "4"


def test_default_page_size_is_100(client, session, course):
    session.add_all(
        ScheduleSession(
            course_id=course.id,
            weekday=index % 5,
            start_time=time(8 + index % 10),
            end_time=time(9 + index % 10),
        )
        for index in range(105)
    )
    session.commit()

    first = client.get("/timetable/sessions")
    second = client.get("/timetable/sessions?page=2")

    assert len(first.json()) == 100
    assert len(second.json()) == 5
    assert first.headers["X-Total-Count"] == "105"
    assert not {item["id"] for item in first.json()} & {item["id"] for item in second.json()}


@pytest.mark.parametrize("query", ["page=0", "page=-1", "page_size=0", "page_size=501"])
def test_invalid_pages_are_rejected(client, timetable, query):
    assert client.get(f"/timetable/sessions?{query}").status_code == 422


def test_largest_page_size_is_allowed(client, timetable):
    response = client.get("/timetable/sessions?page_size=500")

    assert response.status_code == 200
    assert len(response.json()) == 5


def test_browsers_can_read_the_total_count(client, timetable):
    response = client.get(
        "/timetable/sessions", headers={"Origin": "http://localhost:3000"}
    )

    assert "x-total-count" in response.headers["access-control-expose-headers"].lower()


# --- Create and update return the same enriched view -------------------------


def test_create_and_update_return_enriched_sessions(client, timetable):
    compilers = timetable["course_id"]["compilers"]
    lab = timetable["room_id"]["lab"]
    payload = {
        "course_id": compilers,
        "room_id": None,
        "weekday": 4,
        "start_time": "10:00",
        "end_time": "12:00",
    }

    created = client.post("/timetable/sessions", json=payload)
    updated = client.put(
        f"/timetable/sessions/{created.json()['id']}", json={**payload, "room_id": lab}
    )

    assert created.status_code == 201
    assert created.json()["course_name"] == "Compilers"
    assert created.json()["degree_name"] == "Computer Science"
    assert created.json()["room_code"] is None
    assert created.json()["teacher_names"] == []
    assert updated.status_code == 200
    assert updated.json()["room_code"] == "LAB-A"
    friday = client.get("/timetable/sessions?weekday=4").json()
    assert friday == [updated.json()]
