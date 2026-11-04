"""JSON seed preview and import endpoints for trusted local development only."""
import json

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal, engine
from app.seed.seed_sample_data import REQUIRED_TABLES, load_dataset, room_differences, validate

router = APIRouter(prefix="/seed", tags=["sample data"])
MAX_JSON_BYTES = 256 * 1024



async def parse_dataset(request: Request):
    # Check real request size even when Content-Length is absent or incorrect.
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_JSON_BYTES:
            raise HTTPException(413, "JSON dataset exceeds 256 KB.")
    try:
        data = json.loads(body)
        validate(data)
    except (ValueError, TypeError, KeyError, IndexError) as exc:
        raise HTTPException(422, f"Invalid dataset: {exc}") from exc
    return data


def summary(data):
    return {
        "degree": data["degree"]["name"],
        "years": len(data["years"]),
        "semesters": sum(len(y["semesters"]) for y in data["years"]),
        "courses": len(data["courses"]),
        "teachers": len(data["teachers"]),
        "rooms": len(data["rooms"]),
    }


@router.post("/validate")
async def preview(request: Request):
    data = await parse_dataset(request)
    with SessionLocal() as session:
        differences = room_differences(session, data)
    return {"valid": True, "summary": summary(data),
            "room_conflicts": differences,
            "note": "Database room differences require explicit confirmation; existing room records are never overwritten."}


@router.post("/import")
async def import_dataset(request: Request, reuse_existing_rooms: bool = False):
    data = await parse_dataset(request)
    missing = REQUIRED_TABLES - set(inspect(engine).get_table_names())
    if missing:
        raise HTTPException(503, f"Missing database tables: {sorted(missing)}")
    try:
        with SessionLocal() as session, session.begin():
            conflicts = room_differences(session, data)
            if conflicts and not reuse_existing_rooms:
                raise ValueError("Existing rooms have different properties; validate and explicitly confirm reuse")
            load_dataset(session, data, reuse_existing_rooms=reuse_existing_rooms)
    except (ValueError, IntegrityError) as exc:
        raise HTTPException(409, f"Import conflict: {exc}") from exc
    return {"imported": True, "summary": summary(data),
            "room_conflicts_reused": len(conflicts),
            "message": "Import committed. Matching records and approved shared-room values were reused; no existing room was overwritten."}


# Read-only catalogue for the Data Loader.
@router.get("/records")
def list_imported_records(degree_id: int | None = None):
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.models import Course, Degree, Room, Teacher, Year

    with SessionLocal() as session:
        degrees = session.scalars(select(Degree).order_by(Degree.name)).all()
        if degree_id is not None and not any(d.id == degree_id for d in degrees):
            raise HTTPException(404, "Degree not found.")

        query = select(Course).options(selectinload(Course.teachers)).order_by(Course.name, Course.id)
        if degree_id is not None:
            query = query.where(Course.degree_id == degree_id)
        courses = session.scalars(query).all()
        degree_by_id = {d.id: d.name for d in degrees}
        course_rows = [{
            "id": c.id, "name": c.name, "degree_id": c.degree_id,
            "degree": degree_by_id.get(c.degree_id, ""),
            "year_id": c.year_id, "semester_id": c.semester_id,
            "weekly_hours": c.weekly_hours, "enrolled_students": c.enrolled_students,
            "requires_lab": c.requires_lab,
            "teachers": [{"id": t.id, "name": t.name, "identifier": t.identifier} for t in c.teachers],
        } for c in courses]

        years_query = select(Year).options(selectinload(Year.semesters)).order_by(Year.degree_id, Year.number)
        if degree_id is not None:
            years_query = years_query.where(Year.degree_id == degree_id)
        years = session.scalars(years_query).all()
        semester_info = {s.id: (y.number, s.number) for y in years for s in y.semesters}
        for row in course_rows:
            year_number, semester_number = semester_info.get(row["semester_id"], (None, None))
            row["year"] = year_number
            row["semester"] = semester_number

        # Teachers are shared globally; limit to those attached to selected courses
        # when a programme is chosen. Otherwise show the entire catalogue.
        teachers_query = select(Teacher).order_by(Teacher.name, Teacher.id)
        if degree_id is not None:
            teacher_ids = {t["id"] for c in course_rows for t in c["teachers"]}
            teachers = session.scalars(teachers_query.where(Teacher.id.in_(teacher_ids))).all() if teacher_ids else []
        else:
            teachers = session.scalars(teachers_query).all()
        course_names_by_teacher = {}
        for c in course_rows:
            for teacher in c["teachers"]:
                course_names_by_teacher.setdefault(teacher["id"], []).append(c["name"])
        teacher_rows = [{"id": t.id, "name": t.name, "identifier": t.identifier,
                         "courses": sorted(set(course_names_by_teacher.get(t.id, [])))} for t in teachers]

        # Rooms are global shared resources: no degree-room relationship exists.
        rooms = session.scalars(select(Room).order_by(Room.code)).all()
        room_rows = [{"id": r.id, "code": r.code, "capacity": r.capacity,
                      "is_lab": r.is_lab, "has_computers": r.has_computers,
                      "has_projector": r.has_projector} for r in rooms]
        year_rows = [{"id": y.id, "degree_id": y.degree_id,
                      "degree": degree_by_id.get(y.degree_id, ""), "number": y.number,
                      "semesters": [{"id": s.id, "number": s.number} for s in y.semesters]} for y in years]
        return {"degrees": [{"id": d.id, "name": d.name} for d in degrees],
                "courses": course_rows, "teachers": teacher_rows,
                "rooms": room_rows, "years": year_rows}
