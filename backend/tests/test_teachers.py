import pytest

from app.models import Course, Teacher

ROSSI = {"name": "Mario Rossi", "identifier": "m.rossi@unical.it"}
BIANCHI = {"name": "Anna Bianchi", "identifier": "STAFF-042"}


@pytest.fixture()
def second_course(session, course):
    other = Course(
        name="Algorithms",
        degree_id=course.degree_id,
        year_id=course.year_id,
        semester_id=course.semester_id,
        weekly_hours=6,
        enrolled_students=90,
    )
    session.add(other)
    session.commit()
    return other


def create_teacher(client, **overrides):
    response = client.post("/teachers", json={**ROSSI, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


# --- Create -------------------------------------------------------------------


def test_create_teacher_without_courses(client, session):
    body = create_teacher(client)

    assert isinstance(body.pop("id"), int)
    assert body == {**ROSSI, "course_count": 0, "courses": []}
    assert session.query(Teacher).count() == 1


def test_create_teacher_trims_name_and_identifier(client):
    body = create_teacher(client, name="  Mario Rossi ", identifier=" STAFF-1 ")

    assert body["name"] == "Mario Rossi"
    assert body["identifier"] == "STAFF-1"


def test_create_teacher_with_courses(client, course, second_course):
    body = create_teacher(client, course_ids=[course.id, second_course.id])

    assert body["course_count"] == 2
    assert [c["name"] for c in body["courses"]] == ["Algorithms", "Databases"]
    assert body["courses"][0]["degree"] == "Computer Science"


@pytest.mark.parametrize("field", ["name", "identifier"])
@pytest.mark.parametrize("value", ["", "   "])
def test_blank_fields_are_rejected(client, field, value):
    response = client.post("/teachers", json={**ROSSI, field: value})

    assert response.status_code == 422


def test_duplicate_identifier_is_rejected_with_clear_message(client):
    create_teacher(client)

    response = client.post(
        "/teachers", json={**BIANCHI, "identifier": "M.Rossi@UNICAL.it"}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "A teacher with the identifier 'M.Rossi@UNICAL.it' already exists."
    )


def test_create_with_unknown_course_is_rejected(client):
    response = client.post("/teachers", json={**ROSSI, "course_ids": [999]})

    assert response.status_code == 404
    assert client.get("/teachers").json() == []


# --- List and view ------------------------------------------------------------


def test_list_teachers_shows_name_identifier_and_course_count(client, course):
    create_teacher(client, course_ids=[course.id])
    create_teacher(client, **BIANCHI)

    rows = client.get("/teachers").json()

    assert [(r["name"], r["identifier"], r["course_count"]) for r in rows] == [
        ("Anna Bianchi", "STAFF-042", 0),
        ("Mario Rossi", "m.rossi@unical.it", 1),
    ]


def test_teacher_can_teach_many_courses_and_course_many_teachers(
    client, course, second_course
):
    rossi = create_teacher(client, course_ids=[course.id, second_course.id])
    bianchi = create_teacher(client, **BIANCHI, course_ids=[course.id])

    assert client.get(f"/teachers/{rossi['id']}").json()["course_count"] == 2
    view = client.get(f"/courses/{course.id}/teachers").json()
    assert view["name"] == "Databases"
    assert [t["id"] for t in view["teachers"]] == [bianchi["id"], rossi["id"]]


def test_get_unknown_teacher_returns_404(client):
    assert client.get("/teachers/999").status_code == 404


# --- Update -------------------------------------------------------------------


def test_update_name_identifier_and_courses(client, course, second_course):
    teacher = create_teacher(client, course_ids=[course.id])

    response = client.put(
        f"/teachers/{teacher['id']}",
        json={**BIANCHI, "course_ids": [second_course.id]},
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["name"], body["identifier"]) == ("Anna Bianchi", "STAFF-042")
    assert [c["id"] for c in body["courses"]] == [second_course.id]


def test_update_without_course_ids_keeps_assignments(client, course):
    teacher = create_teacher(client, course_ids=[course.id])

    body = client.put(f"/teachers/{teacher['id']}", json=BIANCHI).json()

    assert body["course_count"] == 1


def test_update_can_keep_own_identifier(client):
    teacher = create_teacher(client)

    response = client.put(
        f"/teachers/{teacher['id']}", json={**ROSSI, "name": "Mario A. Rossi"}
    )

    assert response.status_code == 200


def test_update_to_duplicate_identifier_is_rejected(client):
    create_teacher(client)
    other = create_teacher(client, **BIANCHI)

    response = client.put(f"/teachers/{other['id']}", json=ROSSI)

    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_update_unknown_teacher_returns_404(client):
    assert client.put("/teachers/999", json=ROSSI).status_code == 404


# --- Course assignments -------------------------------------------------------


def test_assign_teachers_from_the_course(client, course):
    rossi = create_teacher(client)
    bianchi = create_teacher(client, **BIANCHI)

    response = client.put(
        f"/courses/{course.id}/teachers",
        json={"teacher_ids": [rossi["id"], bianchi["id"]]},
    )

    assert response.status_code == 200
    assert len(response.json()["teachers"]) == 2
    assert client.get(f"/teachers/{rossi['id']}").json()["course_count"] == 1

    cleared = client.put(f"/courses/{course.id}/teachers", json={"teacher_ids": []})
    assert cleared.json()["teachers"] == []


def test_assign_unknown_teacher_or_course_returns_404(client, course):
    assert (
        client.put(f"/courses/{course.id}/teachers", json={"teacher_ids": [9]})
    ).status_code == 404
    assert (
        client.put("/courses/999/teachers", json={"teacher_ids": []})
    ).status_code == 404
    assert client.get("/courses/999/teachers").status_code == 404


# --- Delete -------------------------------------------------------------------


def test_delete_unassigned_teacher(client):
    teacher = create_teacher(client)

    assert client.delete(f"/teachers/{teacher['id']}").status_code == 204
    assert client.get("/teachers").json() == []


def test_delete_assigned_teacher_warns_first(client, course):
    teacher = create_teacher(client, course_ids=[course.id])

    response = client.delete(f"/teachers/{teacher['id']}")

    assert response.status_code == 409
    assert "assigned to 1 course(s)" in response.json()["detail"]
    assert client.get(f"/teachers/{teacher['id']}").status_code == 200


def test_force_delete_removes_assignments_but_keeps_course(client, course):
    teacher = create_teacher(client, course_ids=[course.id])

    response = client.delete(f"/teachers/{teacher['id']}?force=true")

    assert response.status_code == 204
    view = client.get(f"/courses/{course.id}/teachers").json()
    assert view["teachers"] == []


def test_delete_unknown_teacher_returns_404(client):
    assert client.delete("/teachers/999").status_code == 404
