import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.models import AppUser, Degree

def test_create_degree_generates_years_and_semesters(director_client):
    response = director_client.post(
        "/degrees",
        json={"name": "Computer Science", "years": 3, "semesters_per_year": 2},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Computer Science"
    assert len(body["years"]) == 3
    assert all(len(year["semesters"]) == 2 for year in body["years"])


def test_create_degree_rejects_duplicate(director_client):
    director_client.post("/degrees", json={"name": "Mathematics", "years": 2})
    duplicate = director_client.post("/degrees", json={"name": "Mathematics", "years": 2})
    assert duplicate.status_code == 409


def test_create_degree_rejects_case_insensitive_duplicate_after_trimming(director_client):
    created = director_client.post(
        "/degrees",
        json={"name": "  Computer Science  ", "years": 2},
    )
    assert created.status_code == 201
    duplicate = director_client.post(
        "/degrees",
        json={"name": "computer science", "years": 2},
    )
    assert duplicate.status_code == 409


def test_update_degree_rejects_case_insensitive_duplicate_name(director_client):
    director_client.post("/degrees", json={"name": "Chemistry", "years": 2})
    created = director_client.post("/degrees", json={"name": "Physics", "years": 2}).json()
    updated = director_client.put(
        f"/degrees/{created['id']}",
        json={"name": "chemistry", "years": 2},
    )
    assert updated.status_code == 409


def test_create_degree_rejects_invalid_year_count(director_client):
    too_many = director_client.post("/degrees", json={"name": "X", "years": 99})
    assert too_many.status_code == 422


def test_list_degrees_reports_course_count(director_client):
    director_client.post("/degrees", json={"name": "Physics", "years": 1})
    listing = director_client.get("/degrees")
    assert listing.status_code == 200
    physics = next(d for d in listing.json() if d["name"] == "Physics")
    assert physics["courses"] == 0
    assert physics["years"] == 1


def test_degree_details_reports_per_year_course_counts_after_adding_year(
    director_client, course, session
):
    director = session.query(AppUser).filter_by(role="director").one()
    director.degrees.append(session.get(Degree, course.degree_id))
    session.commit()
    degree_id = course.degree_id
    details = director_client.get(f"/degrees/{degree_id}")
    assert details.status_code == 200
    assert details.json()["years"][0]["courses"] == 1
    assert details.json()["years"][0]["semesters"][0]["courses"] == 1

    updated = director_client.put(
        f"/degrees/{degree_id}",
        json={"name": "Computer Science", "years": 2},
    )
    assert updated.status_code == 200
    assert [year["courses"] for year in updated.json()["years"]] == [1, 0]
    assert [
        semester["courses"]
        for year in updated.json()["years"]
        for semester in year["semesters"]
    ] == [1, 0, 0, 0]


def test_get_missing_degree_returns_404(director_client):
    assert director_client.get("/degrees/9999").status_code == 404


def test_update_degree_name_and_years(director_client):
    created = director_client.post("/degrees", json={"name": "Chemistry", "years": 2}).json()
    updated = director_client.put(
        f"/degrees/{created['id']}",
        json={"name": "Applied Chemistry", "years": 4},
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["name"] == "Applied Chemistry"
    assert len(body["years"]) == 4


def test_delete_degree(director_client):
    created = director_client.post("/degrees", json={"name": "History", "years": 1}).json()
    assert director_client.delete(f"/degrees/{created['id']}").status_code == 204
    assert director_client.get(f"/degrees/{created['id']}").status_code == 404


def test_list_degrees_keeps_course_counts_separate(director_client, course, session):
    director = session.query(AppUser).filter_by(role="director").one()
    director.degrees.append(session.get(Degree, course.degree_id))
    session.commit()
    created = director_client.post(
        "/degrees",
        json={"name": "Mathematics", "years": 1},
    )
    assert created.status_code == 201

    response = director_client.get("/degrees")
    assert response.status_code == 200

    degrees = {degree["name"]: degree for degree in response.json()}

    assert degrees["Computer Science"]["courses"] == 1
    assert degrees["Mathematics"]["courses"] == 0


def test_directors_only_see_assigned_degrees(
    director_client, session, make_token
):
    director_one = AppUser(id=uuid.uuid4(), role="director")
    director_two = AppUser(id=uuid.uuid4(), role="director")

    degree_one = Degree(name="Computer Science")
    degree_two = Degree(name="Mathematics")

    director_one.degrees.append(degree_one)
    director_two.degrees.append(degree_two)

    session.add_all([director_one, director_two])
    session.commit()
    token_one = make_token(director_one.id)
    token_two = make_token(director_two.id)

    director_client_one = TestClient(
        app, headers={"Authorization": f"Bearer {token_one}"}
    )
    director_client_two = TestClient(
        app, headers={"Authorization": f"Bearer {token_two}"}
    )

    response_one = director_client_one.get("/degrees")
    response_two = director_client_two.get("/degrees")
    cross_access = director_client_one.get(f"/degrees/{degree_two.id}")
    assert cross_access.status_code == 403

    assert response_one.status_code == 200
    assert response_two.status_code == 200

    assert [d["name"] for d in response_one.json()] == ["Computer Science"]
    assert [d["name"] for d in response_two.json()] == ["Mathematics"]
