def test_create_degree_generates_years_and_semesters(client):
    response = client.post(
        "/degrees",
        json={"name": "Computer Science", "years": 3, "semesters_per_year": 2},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Computer Science"
    assert len(body["years"]) == 3
    assert all(len(year["semesters"]) == 2 for year in body["years"])


def test_create_degree_rejects_duplicate(client):
    client.post("/degrees", json={"name": "Mathematics", "years": 2})
    duplicate = client.post("/degrees", json={"name": "Mathematics", "years": 2})
    assert duplicate.status_code == 409


def test_create_degree_rejects_invalid_year_count(client):
    too_many = client.post("/degrees", json={"name": "X", "years": 99})
    assert too_many.status_code == 422


def test_list_degrees_reports_course_count(client):
    client.post("/degrees", json={"name": "Physics", "years": 1})
    listing = client.get("/degrees")
    assert listing.status_code == 200
    physics = next(d for d in listing.json() if d["name"] == "Physics")
    assert physics["courses"] == 0
    assert physics["years"] == 1


def test_get_missing_degree_returns_404(client):
    assert client.get("/degrees/9999").status_code == 404


def test_update_degree_name_and_years(client):
    created = client.post("/degrees", json={"name": "Chemistry", "years": 2}).json()
    updated = client.put(
        f"/degrees/{created['id']}",
        json={"name": "Applied Chemistry", "years": 4},
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["name"] == "Applied Chemistry"
    assert len(body["years"]) == 4


def test_delete_degree(client):
    created = client.post("/degrees", json={"name": "History", "years": 1}).json()
    assert client.delete(f"/degrees/{created['id']}").status_code == 204
    assert client.get(f"/degrees/{created['id']}").status_code == 404
