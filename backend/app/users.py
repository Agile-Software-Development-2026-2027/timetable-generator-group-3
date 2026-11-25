import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import CurrentUser, require_role
from app.database import get_session
from app.models import AppUser, Degree

router = APIRouter(prefix="/users", tags=["users"])

Database = Annotated[Session, Depends(get_session)]


class DegreeAssignment(BaseModel):
    degree_ids: list[int]


class DegreeAssignmentView(BaseModel):
    user_id: uuid.UUID
    degree_ids: list[int]


@router.put("/{user_id}/degrees", response_model=DegreeAssignmentView)
def assign_degrees(
    user_id: uuid.UUID,
    data: DegreeAssignment,
    session: Database,
    _current_user: Annotated[
        CurrentUser, Depends(require_role("director"))
    ],
) -> DegreeAssignmentView:
    user = session.get(AppUser, user_id)

    if user is None:
        raise HTTPException(404, "User not found.")

    if user.role != "director":
        raise HTTPException(400, "Degrees can only be assigned to directors.")

    degrees = session.scalars(
        select(Degree).where(Degree.id.in_(data.degree_ids))
    ).all()

    if len(degrees) != len(set(data.degree_ids)):
        raise HTTPException(404, "One or more degrees were not found.")

    user.degrees = list(degrees)
    session.commit()

    return DegreeAssignmentView(
        user_id=user.id,
        degree_ids=[degree.id for degree in user.degrees],
    )
