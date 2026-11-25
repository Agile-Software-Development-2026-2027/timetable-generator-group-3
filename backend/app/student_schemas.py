"""Request and response schemas for the student's personal courses."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AvailableCourseView(BaseModel):
    """A course that can be presented in the enrollment catalogue."""

    model_config = ConfigDict(from_attributes=True)

    id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=255)
    degree_id: int = Field(gt=0)
    year_id: int = Field(gt=0)
    semester_id: int = Field(gt=0)


class StudentCourseView(AvailableCourseView):
    """A course belonging to the student's personal course set."""

    is_extra: bool = Field(
        description=(
            "False for degree-and-year assigned courses; "
            "True for additional explicit enrollments."
        )
    )


class EnrollmentInput(BaseModel):
    """Request to add one extra course to the current student."""

    model_config = ConfigDict(extra="forbid")

    course_id: int = Field(gt=0, strict=True)


class EnrollmentView(BaseModel):
    """Confirmation of a successful extra course enrollment."""

    model_config = ConfigDict(from_attributes=True)

    course_id: int = Field(gt=0)
    enrolled_at: datetime
