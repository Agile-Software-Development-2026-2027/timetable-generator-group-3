import pytest

from app.models import Degree, Enrollment, Student, Year


@pytest.fixture()
def director(auth_client):
    return auth_client("director")


@pytest.fixture()
def student_data(course):
    return {
        "name": "Alice Student",
        "student_number": "001234",
        "degree_id": course.degree_id,
        "year_id": course.year_id,
    }


def test_student_crud(director, student_data):
    response = director.post("/students", json=student_data)
    assert response.status_code == 201

    created = response.json()
    student_id = created["id"]

    assert created["student_number"] == "001234"
    assert created["name"] == student_data["name"]

    response = director.get("/students")
    assert response.status_code == 200
    assert created in response.json()

    response = director.get(f"/students/{student_id}")
    assert response.status_code == 200
    assert response.json() == created

    updated = {**student_data, "name": "Alice Updated"}

    response = director.put(
        f"/students/{student_id}", json=updated
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Alice Updated"

    response = director.delete(f"/students/{student_id}")
    assert response.status_code == 204

    response = director.get(f"/students/{student_id}")
    assert response.status_code == 404


def test_student_fields_are_trimmed(director, student_data):
    data = {
        **student_data,
        "name": "  Alice Student  ",
        "student_number": "  001234  ",
    }

    response = director.post("/students", json=data)

    assert response.status_code == 201
    assert response.json()["name"] == "Alice Student"
    assert response.json()["student_number"] == "001234"


@pytest.mark.parametrize("duplicate", ["ABC123", "abc123"])
def test_duplicate_student_number(
    director, student_data, duplicate
):
    first = {**student_data, "student_number": "ABC123"}
    second = {
        **student_data,
        "name": "Another Student",
        "student_number": duplicate,
    }

    assert director.post("/students", json=first).status_code == 201

    response = director.post("/students", json=second)

    assert response.status_code == 409


def test_duplicate_student_number_on_update(
    director, student_data
):
    first = director.post(
        "/students",
        json={**student_data, "student_number": "ABC123"},
    )
    second = director.post(
        "/students",
        json={**student_data, "student_number": "XYZ456"},
    )

    assert first.status_code == 201
    assert second.status_code == 201

    student_id = second.json()["id"]

    response = director.put(
        f"/students/{student_id}",
        json={**student_data, "student_number": "abc123"},
    )

    assert response.status_code == 409


def test_update_can_keep_own_student_number(
    director, student_data
):
    created = director.post("/students", json=student_data)
    assert created.status_code == 201

    student_id = created.json()["id"]

    response = director.put(
        f"/students/{student_id}", json=student_data
    )

    assert response.status_code == 200


def test_year_must_belong_to_degree(
    director, student_data, session
):
    other_degree = Degree(
        name="Other Degree",
        years=[Year(number=1)],
    )
    session.add(other_degree)
    session.commit()

    response = director.post(
        "/students",
        json={
            **student_data,
            "year_id": other_degree.years[0].id,
        },
    )

    assert response.status_code == 422


@pytest.mark.parametrize("field", ["degree_id", "year_id"])
def test_missing_academic_record(director, student_data, field):
    response = director.post(
        "/students",
        json={**student_data, field: 999999},
    )

    assert response.status_code == 404


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", ""),
        ("name", "   "),
        ("student_number", ""),
        ("student_number", "   "),
        ("student_number", "A" * 33),
        ("degree_id", 0),
        ("year_id", 0),
    ],
)
def test_invalid_student_input(
    director, student_data, field, value
):
    response = director.post(
        "/students",
        json={**student_data, field: value},
    )

    assert response.status_code == 422


def test_missing_student(director, student_data):
    assert director.get("/students/999999").status_code == 404

    response = director.put(
        "/students/999999", json=student_data
    )
    assert response.status_code == 404

    assert director.delete("/students/999999").status_code == 404


def test_student_endpoints_require_authentication(
    client, student_data
):
    requests = [
        client.get("/students"),
        client.get("/students/1"),
        client.post("/students", json=student_data),
        client.put("/students/1", json=student_data),
        client.delete("/students/1"),
    ]

    assert all(response.status_code == 401 for response in requests)


@pytest.mark.parametrize("role", ["teacher", "student"])
def test_only_directors_can_manage_students(
    auth_client, student_data, role
):
    user = auth_client(role)

    requests = [
        user.get("/students"),
        user.get("/students/1"),
        user.post("/students", json=student_data),
        user.put("/students/1", json=student_data),
        user.delete("/students/1"),
    ]

    assert all(response.status_code == 403 for response in requests)


def test_delete_student_removes_enrollments(
    director, student_data, session, course
):
    student = Student(**student_data)
    session.add(student)
    session.flush()

    student_id = student.id
    course_id = course.id

    enrollment = Enrollment(
        student_id=student_id,
        course_id=course_id,
    )
    session.add(enrollment)
    session.commit()

    assert enrollment.enrolled_at is not None

    response = director.delete(f"/students/{student_id}")

    assert response.status_code == 204

    session.expire_all()

    assert session.get(Student, student_id) is None
    assert session.get(
        Enrollment, (student_id, course_id)
    ) is None


def test_database_rejects_case_insensitive_student_number(session, course):
    import pytest
    from sqlalchemy.exc import IntegrityError
    from app.models import Student

    first = Student(
        name="First Student",
        student_number="ABC123",
        degree_id=course.degree_id,
        year_id=course.year_id,
    )
    session.add(first)
    session.commit()

    duplicate = Student(
        name="Second Student",
        student_number="abc123",
        degree_id=course.degree_id,
        year_id=course.year_id,
    )
    session.add(duplicate)

    with pytest.raises(IntegrityError):
        session.commit()

    session.rollback()

    assert session.get(Student, first.id).student_number == "ABC123"


def test_database_rejects_exact_duplicate_student_number(session, course):
    import pytest
    from sqlalchemy.exc import IntegrityError
    from app.models import Student

    session.add(Student(
        name="First Student",
        student_number="001234",
        degree_id=course.degree_id,
        year_id=course.year_id,
    ))
    session.commit()

    session.add(Student(
        name="Second Student",
        student_number="001234",
        degree_id=course.degree_id,
        year_id=course.year_id,
    ))

    with pytest.raises(IntegrityError):
        session.commit()

    session.rollback()


def test_database_preserves_distinct_student_number_leading_zeros(session, course):
    from sqlalchemy import select
    from app.models import Student

    session.add_all([
        Student(
            name="First Student",
            student_number="001234",
            degree_id=course.degree_id,
            year_id=course.year_id,
        ),
        Student(
            name="Second Student",
            student_number="1234",
            degree_id=course.degree_id,
            year_id=course.year_id,
        ),
    ])

    session.commit()

    numbers = set(session.scalars(
        select(Student.student_number)
    ).all())

    assert {"001234", "1234"}.issubset(numbers)
