from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.models import Course, Enrollment
from app.student_schemas import (
    AvailableCourseView,
    EnrollmentInput,
    EnrollmentView,
    StudentCourseView,
)


COURSE_DATA = {
    "id": 1,
    "name": "Databases",
    "degree_id": 2,
    "year_id": 3,
    "semester_id": 4,
}


def test_available_course_serialization():
    course = AvailableCourseView(**COURSE_DATA)

    assert course.model_dump() == COURSE_DATA
    assert "is_extra" not in course.model_dump()


def test_available_course_from_orm():
    course = Course(**COURSE_DATA)

    result = AvailableCourseView.model_validate(course)

    assert result.model_dump() == COURSE_DATA


@pytest.mark.parametrize("is_extra", [False, True])
def test_student_course_classification(is_extra):
    course = StudentCourseView(**COURSE_DATA, is_extra=is_extra)

    assert course.model_dump() == {
        **COURSE_DATA,
        "is_extra": is_extra,
    }


def test_student_course_requires_classification():
    with pytest.raises(ValidationError):
        StudentCourseView(**COURSE_DATA)


def test_student_course_from_attributes():
    course = SimpleNamespace(**COURSE_DATA, is_extra=True)

    result = StudentCourseView.model_validate(course)

    assert result.is_extra is True
    assert result.id == 1


@pytest.mark.parametrize(
    "field",
    ["id", "degree_id", "year_id", "semester_id"],
)
@pytest.mark.parametrize("value", [0, -1])
def test_course_rejects_nonpositive_identifiers(field, value):
    with pytest.raises(ValidationError):
        AvailableCourseView(**{**COURSE_DATA, field: value})


@pytest.mark.parametrize("name", ["", "x" * 256])
def test_course_rejects_invalid_name_length(name):
    with pytest.raises(ValidationError):
        AvailableCourseView(**{**COURSE_DATA, "name": name})


@pytest.mark.parametrize("course_id", [1, 5, 100])
def test_valid_enrollment_request(course_id):
    request = EnrollmentInput(course_id=course_id)

    assert request.model_dump() == {"course_id": course_id}


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"course_id": 0},
        {"course_id": -1},
        {"course_id": "5"},
        {"course_id": True},
        {"course_id": 2.5},
        {"course_id": 5.0},
        {"course_id": None},
        {"course_id": 5, "student_id": 10},
        {"course_id": 5, "role": "director"},
    ],
)
def test_invalid_enrollment_request(payload):
    with pytest.raises(ValidationError):
        EnrollmentInput.model_validate(payload)


def test_enrollment_response_from_orm():
    timestamp = datetime(2026, 1, 1, 10, 30, tzinfo=timezone.utc)
    enrollment = Enrollment(
        student_id=20,
        course_id=5,
        enrolled_at=timestamp,
    )

    result = EnrollmentView.model_validate(enrollment)

    assert result.model_dump() == {
        "course_id": 5,
        "enrolled_at": timestamp,
    }
    assert "student_id" not in result.model_dump()


def test_enrollment_response_json_timestamp():
    timestamp = datetime(2026, 1, 1, 10, 30, tzinfo=timezone.utc)

    result = EnrollmentView(course_id=5, enrolled_at=timestamp)

    assert result.model_dump(mode="json") == {
        "course_id": 5,
        "enrolled_at": "2026-01-01T10:30:00Z",
    }


def test_enrollment_response_requires_timestamp():
    with pytest.raises(ValidationError):
        EnrollmentView(course_id=5)


def test_enrollment_response_rejects_invalid_course_id():
    with pytest.raises(ValidationError):
        EnrollmentView(
            course_id=0,
            enrolled_at=datetime.now(timezone.utc),
        )


def test_enrollment_request_schema_forbids_extra_fields():
    schema = EnrollmentInput.model_json_schema()

    assert schema["additionalProperties"] is False
    assert schema["required"] == ["course_id"]
    assert set(schema["properties"]) == {"course_id"}
