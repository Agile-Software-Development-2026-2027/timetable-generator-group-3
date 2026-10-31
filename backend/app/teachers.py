from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List
import re

from app.database import get_session
from app.models import TeacherCreate, TeacherUpdate, TeacherResponse, CourseRef

router = APIRouter(prefix="/api/teachers", tags=["teachers"])

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
STAFF_REGEX = re.compile(r"^[a-zA-Z0-9_-]{3,20}$")

def validate_input(identifier: str = None, full_name: str = None):
    if identifier is not None:
        clean_id = identifier.strip()
        if len(clean_id) < 3:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Identifier must be at least 3 characters long."
            )
        if " " in clean_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Identifier cannot contain spaces."
            )

        if "@" in clean_id or re.search(r"\.[a-zA-Z]{2,}$", clean_id):
            if not EMAIL_REGEX.match(clean_id):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Invalid email format: an '@' symbol and a valid domain are required."
                )
        elif not STAFF_REGEX.match(clean_id):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid staff code: only alphanumeric characters, underscores, and hyphens are allowed."
            )

    if full_name is not None:
        clean_name = full_name.strip()
        if len(clean_name) < 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Full name must contain at least 2 characters."
            )

@router.post("/", response_model=TeacherResponse, status_code=status.HTTP_201_CREATED)
def create_teacher(payload: TeacherCreate, db: Session = Depends(get_session)):
    clean_identifier = payload.identifier.strip()
    clean_full_name = payload.full_name.strip()

    validate_input(clean_identifier, clean_full_name)

    existing = db.execute(
        text("SELECT id FROM teachers WHERE LOWER(identifier) = LOWER(:identifier)"),
        {"identifier": clean_identifier}
    ).fetchone()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Teacher with identifier '{clean_identifier}' already exists."
        )

    db.execute(
        text("INSERT INTO teachers (identifier, full_name) VALUES (:identifier, :full_name)"),
        {"identifier": clean_identifier, "full_name": clean_full_name}
    )
    db.commit()

    teacher_row = db.execute(
        text("SELECT id, identifier, full_name FROM teachers WHERE identifier = :identifier"),
        {"identifier": clean_identifier}
    ).fetchone()
    teacher_id = teacher_row[0]

    if payload.course_ids:
        for c_id in payload.course_ids:
            db.execute(
                text("INSERT INTO course_teachers (course_id, teacher_id) VALUES (:c_id, :t_id)"),
                {"c_id": c_id, "t_id": teacher_id}
            )
        db.commit()

    return get_teacher(teacher_id, db)


@router.get("/", response_model=List[TeacherResponse])
def list_teachers(db: Session = Depends(get_session)):
    query = text("""
        SELECT t.id, t.identifier, t.full_name, COUNT(ct.course_id) AS courses_count
        FROM teachers t
        LEFT JOIN course_teachers ct ON t.id = ct.teacher_id
        GROUP BY t.id, t.identifier, t.full_name
        ORDER BY t.full_name ASC
    """)
    rows = db.execute(query).fetchall()
    return [
        TeacherResponse(
            id=row[0],
            identifier=row[1],
            full_name=row[2],
            courses_count=row[3],
            courses=[]
        )
        for row in rows
    ]


@router.get("/by-course/{course_id}", response_model=List[TeacherResponse])
def get_teachers_by_course(course_id: int, db: Session = Depends(get_session)):
    query = text("""
        SELECT t.id, t.identifier, t.full_name
        FROM teachers t
        JOIN course_teachers ct ON t.id = ct.teacher_id
        WHERE ct.course_id = :course_id
        ORDER BY t.full_name ASC
    """)
    rows = db.execute(query, {"course_id": course_id}).fetchall()
    return [
        TeacherResponse(
            id=r[0],
            identifier=r[1],
            full_name=r[2],
            courses_count=1,
            courses=[]
        )
        for r in rows
    ]


@router.get("/{teacher_id}", response_model=TeacherResponse)
def get_teacher(teacher_id: int, db: Session = Depends(get_session)):
    teacher = db.execute(
        text("SELECT id, identifier, full_name FROM teachers WHERE id = :id"),
        {"id": teacher_id}
    ).fetchone()

    if not teacher:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found.")

    courses_query = text("""
        SELECT c.id, c.name
        FROM course c
        JOIN course_teachers ct ON c.id = ct.course_id
        WHERE ct.teacher_id = :id
    """)
    courses = db.execute(courses_query, {"id": teacher_id}).fetchall()
    course_list = [CourseRef(id=c[0], name=c[1]) for c in courses]

    return TeacherResponse(
        id=teacher[0],
        identifier=teacher[1],
        full_name=teacher[2],
        courses_count=len(course_list),
        courses=course_list
    )


@router.put("/{teacher_id}", response_model=TeacherResponse)
def update_teacher(teacher_id: int, payload: TeacherUpdate, db: Session = Depends(get_session)):
    teacher = db.execute(
        text("SELECT id FROM teachers WHERE id = :id"),
        {"id": teacher_id}
    ).fetchone()

    if not teacher:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found.")

    clean_identifier = payload.identifier.strip() if payload.identifier is not None else None
    clean_full_name = payload.full_name.strip() if payload.full_name is not None else None

    validate_input(clean_identifier, clean_full_name)

    if clean_identifier is not None:
        conflict = db.execute(
            text("SELECT id FROM teachers WHERE LOWER(identifier) = LOWER(:identifier) AND id != :id"),
            {"identifier": clean_identifier, "id": teacher_id}
        ).fetchone()
        if conflict:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Identifier '{clean_identifier}' is already taken."
            )
        db.execute(
            text("UPDATE teachers SET identifier = :identifier WHERE id = :id"),
            {"identifier": clean_identifier, "id": teacher_id}
        )

    if clean_full_name is not None:
        db.execute(
            text("UPDATE teachers SET full_name = :full_name WHERE id = :id"),
            {"full_name": clean_full_name, "id": teacher_id}
        )

    if payload.course_ids is not None:
        db.execute(
            text("DELETE FROM course_teachers WHERE teacher_id = :id"),
            {"id": teacher_id}
        )
        for c_id in payload.course_ids:
            db.execute(
                text("INSERT INTO course_teachers (course_id, teacher_id) VALUES (:c_id, :t_id)"),
                {"c_id": c_id, "t_id": teacher_id}
            )

    db.commit()
    return get_teacher(teacher_id, db)


@router.delete("/{teacher_id}")
def delete_teacher(teacher_id: int, force: bool = Query(False), db: Session = Depends(get_session)):
    teacher = db.execute(
        text("SELECT id FROM teachers WHERE id = :id"),
        {"id": teacher_id}
    ).fetchone()

    if not teacher:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found.")

    assigned = db.execute(
        text("SELECT COUNT(*) FROM course_teachers WHERE teacher_id = :id"),
        {"id": teacher_id}
    ).fetchone()
    assigned_count = assigned[0] if assigned else 0

    if assigned_count > 0 and not force:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Teacher is assigned to {assigned_count} course(s). Unassign first or set force=true to confirm deletion."
        )

    db.execute(text("DELETE FROM course_teachers WHERE teacher_id = :id"), {"id": teacher_id})
    db.execute(text("DELETE FROM teachers WHERE id = :id"), {"id": teacher_id})
    db.commit()

    return {"message": "Teacher removed successfully."}
