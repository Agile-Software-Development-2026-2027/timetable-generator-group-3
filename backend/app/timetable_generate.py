"""KAN-15 automatic timetable generation endpoint."""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.database import get_session
from app.engine.engine import solve
from app.engine.facts import build_problem
from app.engine.validation import validate_solution
from app.models import Degree, Room, ScheduleSession, Semester

router = APIRouter(tags=["timetable"])
Database = Annotated[Session, Depends(get_session)]

class GenerateInput(BaseModel):
    degree_id: int = Field(gt=0)
    semester_id: int | None = Field(default=None, gt=0)


class Unscheduled(BaseModel):
    course_id: int
    name: str
    reason: str


class GenerateResult(BaseModel):
    status: Literal["ok", "partial", "infeasible"]
    sessions_created: int
    unscheduled: list[Unscheduled]


@router.post("/timetable/generate", response_model=GenerateResult)
def generate_timetable(payload: GenerateInput, session: Database):
    if session.get(Degree, payload.degree_id) is None:
        raise HTTPException(404, "Degree not found.")
    if payload.semester_id is not None:
        sem = session.get(Semester, payload.semester_id)
        if sem is None or sem.year.degree_id != payload.degree_id:
            raise HTTPException(404, "Semester not found in selected degree.")

    # Lock shared rooms for competing generation requests in PostgreSQL.
    # This does not protect against uncoordinated manual CRUD writes.
    session.scalars(select(Room).order_by(Room.id).with_for_update()).all()
    problem = build_problem(session, payload.degree_id, payload.semester_id)
    if not problem.courses:
        session.rollback()
        return GenerateResult(status="infeasible", sessions_created=0, unscheduled=[])
    if not problem.rooms or not problem.slots:
        session.rollback()
        return GenerateResult(
            status="infeasible", sessions_created=0,
            unscheduled=[Unscheduled(course_id=c.id, name=c.name,
                                     reason="No rooms or timetable slots available.")
                         for c in problem.courses],
        )

    try:
        solution = solve(problem)
        if solution is None:
            session.rollback()
            return GenerateResult(
                status="infeasible", sessions_created=0,
                unscheduled=[Unscheduled(course_id=c.id, name=c.name,
                         reason="No solution found (constraints may be infeasible or the solver time limit was reached).")
                         for c in problem.courses],
            )

        missing = [c for c in problem.courses if c.id not in solution.scheduled_ids]
        if missing and not solution.assignments:
            # Never erase an existing timetable on an infeasible result.
            session.rollback()
            return GenerateResult(
                status="infeasible", sessions_created=0,
                unscheduled=[Unscheduled(course_id=c.id, name=c.name,
                                         reason="Could not allocate all required slots under hard constraints.")
                             for c in missing],
            )

        # Independent hard-constraint check, before deleting any existing rows.
        validate_solution(problem, solution)

        scoped_ids = [c.id for c in problem.courses]
        session.execute(delete(ScheduleSession).where(ScheduleSession.course_id.in_(scoped_ids)))
        for a in solution.assignments:
            start, end = problem.slots[(a.day, a.slot)]
            session.add(ScheduleSession(course_id=a.course_id, room_id=a.room_id,
                                        weekday=a.day, start_time=start, end_time=end))
        session.commit()
        return GenerateResult(
            status="partial" if missing else "ok",
            sessions_created=len(solution.assignments),
            unscheduled=[Unscheduled(
                course_id=c.id, name=c.name,
                reason=("Solver time limit reached before every course could be scheduled."
                        if solution.timed_out else
                        "Insufficient free slots or eligible rooms under scheduling constraints.")
            ) for c in missing],
        )
    except Exception:
        session.rollback()
        raise
