"""KAN-71: publish a degree timetable as an atomic, read-only snapshot."""
from collections import Counter
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_session
from app.models import Course, Degree, PublishedSession, ScheduleSession, TimetablePublication

router = APIRouter(tags=["timetable"])
Database = Annotated[Session, Depends(get_session)]
Caller = Annotated[CurrentUser, Depends(get_current_user)]


class PublicationStatus(BaseModel):
    published_at: datetime | None
    published_by: str | None
    has_unpublished_changes: bool


def require_degree(session: Session, degree_id: int, *, lock: bool = False) -> Degree:
    query = select(Degree).where(Degree.id == degree_id)
    if lock:
        query = query.with_for_update()
    degree = session.scalar(query)
    if degree is None:
        raise HTTPException(404, "Degree not found.")
    return degree


def signature(record):
    return (record.course_id, record.room_id, record.weekday,
            record.start_time, record.end_time)


def _status(session: Session, degree_id: int) -> PublicationStatus:
    publication = session.get(TimetablePublication, degree_id)
    if publication is None:
        return PublicationStatus(
            published_at=None, published_by=None, has_unpublished_changes=True
        )
    draft = session.scalars(
        select(ScheduleSession).join(Course).where(Course.degree_id == degree_id)
    ).all()
    published = session.scalars(
        select(PublishedSession).where(PublishedSession.degree_id == degree_id)
    ).all()
    return PublicationStatus(
        published_at=publication.published_at,
        published_by=str(publication.published_by),
        has_unpublished_changes=(
            Counter(map(signature, draft)) != Counter(map(signature, published))
        ),
    )


@router.get("/timetable/publication", response_model=PublicationStatus)
def publication_status(
    session: Database,
    user: Caller,
    degree_id: Annotated[int, Query(gt=0)],
) -> PublicationStatus:
    require_degree(session, degree_id)
    return _status(session, degree_id)


@router.post("/timetable/publish", response_model=PublicationStatus)
def publish_timetable(
    session: Database,
    user: Caller,
    degree_id: Annotated[int, Query(gt=0)],
) -> PublicationStatus:
    if user.role != "director":
        raise HTTPException(403, "Only directors can publish timetables.")
    try:
        # PostgreSQL row lock serializes concurrent publications for this degree.
        # All changes below are committed together, or none are committed.
        require_degree(session, degree_id, lock=True)
        draft = session.scalars(
            select(ScheduleSession).join(Course)
            .where(Course.degree_id == degree_id)
            .order_by(ScheduleSession.id)
        ).all()
        session.execute(
            delete(PublishedSession).where(PublishedSession.degree_id == degree_id)
        )
        session.add_all(
            PublishedSession(
                degree_id=degree_id,
                course_id=row.course_id,
                room_id=row.room_id,
                weekday=row.weekday,
                start_time=row.start_time,
                end_time=row.end_time,
            ) for row in draft
        )
        publication = session.get(TimetablePublication, degree_id)
        if publication is None:
            publication = TimetablePublication(degree_id=degree_id)
            session.add(publication)
        publication.published_at = datetime.now(timezone.utc)
        publication.published_by = user.id
        session.commit()
    except Exception:
        session.rollback()
        raise
    return _status(session, degree_id)