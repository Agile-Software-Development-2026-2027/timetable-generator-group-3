"""KAN-72: teacher workload preferences."""

from __future__ import annotations

import json
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_session
from app.models import AppUser, Teacher, TeacherPreferences
from app.slot_config import _load_or_create

router = APIRouter(prefix="/teachers", tags=["teacher-preferences"])

Database = Annotated[Session, Depends(get_session)]
SignedIn = Annotated[CurrentUser, Depends(get_current_user)]


class TeacherPreferencesInput(BaseModel):
    max_hours_per_day: int | None = Field(
        default=None, gt=0, strict=True
    )
    max_teaching_days: int | None = Field(
        default=None, ge=1, le=6, strict=True
    )
    max_consecutive_hours: int | None = Field(
        default=None, gt=0, strict=True
    )
    preferred_part_of_day: Literal[
        "morning", "afternoon", "none"
    ] | None = None


class TeacherPreferencesView(TeacherPreferencesInput):
    model_config = {"from_attributes": True}


def _check_access(
    teacher_id: int, user: CurrentUser, session: Session
) -> None:
    """Directors can access any record; teachers only their own."""
    if user.role == "director":
        return

    if user.role == "teacher":
        account = session.get(AppUser, user.id)
        if account is not None and account.teacher_id == teacher_id:
            return

    raise HTTPException(
        403, "You can only read or change your own workload preferences."
    )


def _check_teacher(teacher_id: int, session: Session) -> None:
    if session.get(Teacher, teacher_id) is None:
        raise HTTPException(404, "Teacher not found.")


def _validate_working_days(
    data: TeacherPreferencesInput, session: Session
) -> None:
    if data.max_teaching_days is None:
        return

    config = _load_or_create(session)
    working_days = len(json.loads(config.working_days))

    if data.max_teaching_days > working_days:
        raise HTTPException(
            422,
            f"Maximum teaching days cannot exceed the number "
            f"of working days ({working_days}).",
        )


@router.get(
    "/{teacher_id}/preferences",
    response_model=TeacherPreferencesView,
)
def get_preferences(
    teacher_id: int, session: Database, user: SignedIn
) -> TeacherPreferencesView:
    _check_access(teacher_id, user, session)
    _check_teacher(teacher_id, session)

    preferences = session.get(TeacherPreferences, teacher_id)

    if preferences is None:
        return TeacherPreferencesView()

    return TeacherPreferencesView.model_validate(preferences)


@router.put(
    "/{teacher_id}/preferences",
    response_model=TeacherPreferencesView,
)
def replace_preferences(
    teacher_id: int,
    data: TeacherPreferencesInput,
    session: Database,
    user: SignedIn,
) -> TeacherPreferencesView:
    _check_access(teacher_id, user, session)
    _check_teacher(teacher_id, session)
    _validate_working_days(data, session)

    preferences = session.get(TeacherPreferences, teacher_id)

    if preferences is None:
        preferences = TeacherPreferences(teacher_id=teacher_id)
        session.add(preferences)

    for field, value in data.model_dump().items():
        setattr(preferences, field, value)

    session.commit()
    session.refresh(preferences)

    return TeacherPreferencesView.model_validate(preferences)
