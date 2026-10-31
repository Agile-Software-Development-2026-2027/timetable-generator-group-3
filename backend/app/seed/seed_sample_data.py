"""Import one or more degree datasets into the existing SQLAlchemy schema.

From backend/: python -m app.seed.seed_sample_data --file app/seed/data/ai_cs.json
Or:            python -m app.seed.seed_sample_data --all

This writes to the database configured by backend/.env.
No tables are created, altered or deleted by this script.
"""
import argparse
import json
from pathlib import Path

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.database import SessionLocal, engine
from app.models import Course, Degree, Room, Semester, Teacher, Year

DATA_DIR = Path(__file__).resolve().parent / "data"
REQUIRED_TABLES = {"degree", "year", "semester", "course", "teacher", "course_teacher", "room"}

def nonblank(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a nonempty string")

def positive(value, label):
    if type(value) is not int or value <= 0:
        raise ValueError(f"{label} must be a positive integer")

def unique(values, label):
    if len(values) != len(set(values)):
        raise ValueError(f"Duplicate {label} in dataset")

def validate(data):
    """Validate dataset and cross-references before opening a write transaction."""
    if not isinstance(data, dict):
        raise ValueError("Dataset must be a JSON object")
    nonblank(data["degree"]["name"], "degree name")
    years = data["years"]
    if not years:
        raise ValueError("At least one year is required")
    year_numbers = []
    valid_slots = set()
    for year in years:
        positive(year["number"], "year number")
        year_numbers.append(year["number"])
        if not year["semesters"]:
            raise ValueError("Every year must have semesters")
        unique(year["semesters"], "semester number")
        for semester in year["semesters"]:
            positive(semester, "semester number")
            valid_slots.add((year["number"], semester))
    unique(year_numbers, "year number")

    room_codes = []
    for room in data["rooms"]:
        nonblank(room["code"], "room code")
        # A code-only object references an existing shared room without redefining it.
        if set(room) == {"code"}:
            room_codes.append(room["code"])
            continue
        expected = {"code", "capacity", "is_lab", "has_computers", "has_projector"}
        if set(room) != expected:
            raise ValueError(f"{room['code']}: supply only code, or all room attributes")
        positive(room["capacity"], "room capacity")
        for flag in ("is_lab", "has_computers", "has_projector"):
            if type(room[flag]) is not bool:
                raise ValueError(f"{room['code']}: {flag} must be boolean")
        room_codes.append(room["code"])
    unique(room_codes, "room code")

    teacher_ids = []
    for teacher in data["teachers"]:
        nonblank(teacher["name"], "teacher name")
        nonblank(teacher["identifier"], "teacher identifier")
        teacher_ids.append(teacher["identifier"])
    unique(teacher_ids, "teacher identifier")

    course_keys = []
    for course in data["courses"]:
        nonblank(course["name"], "course name")
        slot = (course["year"], course["semester"])
        if slot not in valid_slots:
            raise ValueError(f"Unknown year/semester for {course['name']}")
        for field in ("weekly_hours", "enrolled_students"):
            positive(course[field], f"{course['name']}: {field}")
        if type(course["requires_lab"]) is not bool:
            raise ValueError(f"{course['name']}: requires_lab must be boolean")
        assigned = course["teacher_ids"]
        if not assigned:
            raise ValueError(f"{course['name']} has no teachers")
        unique(assigned, f"teacher assignment in {course['name']}")
        if any(identifier not in teacher_ids for identifier in assigned):
            raise ValueError(f"Unknown teacher for {course['name']}")
        # Room references must be resolved against the database before checking suitability.
        course_keys.append((*slot, course["name"]))
    unique(course_keys, "course (year, semester, name)")

    for course_name, codes in data.get("observed_course_rooms", {}).items():
        if course_name not in {c["name"] for c in data["courses"]}:
            raise ValueError(f"Unknown course in observed room mapping: {course_name}")
        if any(code not in room_codes for code in codes):
            raise ValueError(f"Unknown observed room for {course_name}")


def get_or_create(session: Session, model, lookup: dict, values: dict | None = None):
    obj = session.scalar(select(model).filter_by(**lookup))
    if obj is None:
        obj = model(**lookup, **(values or {}))
        session.add(obj)
        session.flush()
    elif values and any(getattr(obj, field) != value for field, value in values.items()):
        raise ValueError(f"Existing {model.__name__} conflicts with dataset: {lookup}")
    return obj

ROOM_FIELDS = ("capacity", "has_projector", "has_computers", "is_lab")


def room_differences(session: Session, data: dict) -> list[dict]:
    """Read-only preview of conflicts; never modifies shared database records."""
    differences = []
    for item in data["rooms"]:
        existing = session.scalar(select(Room).where(Room.code == item["code"]))
        if existing is None or set(item) == {"code"}:
            continue
        changes = {
            field: {"file": item[field], "database": getattr(existing, field)}
            for field in ROOM_FIELDS if item[field] != getattr(existing, field)
        }
        if changes:
            differences.append({"code": item["code"], "differences": changes})
    return differences


def load_dataset(session: Session, data: dict, *, reuse_existing_rooms: bool = False):
    """Insert or reuse one validated degree and its related records."""
    degree = get_or_create(session, Degree, {"name": data["degree"]["name"]})
    slots = {}
    for year_data in data["years"]:
        year = get_or_create(session, Year, {"degree_id": degree.id, "number": year_data["number"]})
        for number in year_data["semesters"]:
            semester = get_or_create(session, Semester, {"year_id": year.id, "number": number})
            slots[(year_data["number"], number)] = (year, semester)

    # All rooms are shared resources. Existing DB metadata is authoritative only
    # when the administrator has explicitly accepted mismatches in the preview.
    for room in data["rooms"]:
        existing = session.scalar(select(Room).where(Room.code == room["code"]))
        if existing is None:
            if set(room) == {"code"}:
                raise ValueError(f"Referenced room {room['code']!r} does not exist")
            session.add(Room(**room))
            session.flush()
        elif set(room) != {"code"}:
            mismatch = [field for field in ROOM_FIELDS if getattr(existing, field) != room[field]]
            if mismatch and not reuse_existing_rooms:
                raise ValueError(
                    f"Room {room['code']!r} differs in {', '.join(mismatch)}; "
                    "review the differences before choosing to reuse database values"
                )

    # The Room table is a global resource pool, not scoped to a degree.
    # Check equipment/capacity against actual database values, never stale JSON.
    for item in data["courses"]:
        if item["requires_lab"] and not session.scalar(
            select(Room.id).where(
                Room.is_lab.is_(True), Room.has_computers.is_(True),
                Room.capacity >= item["enrolled_students"]
            ).limit(1)
        ):
            raise ValueError(f"No sufficiently equipped computer lab for {item['name']}")

    teachers = {}
    for teacher in data["teachers"]:
        teachers[teacher["identifier"]] = get_or_create(
            session, Teacher, {"identifier": teacher["identifier"]}, {"name": teacher["name"]}
        )

    for item in data["courses"]:
        year, semester = slots[(item["year"], item["semester"])]
        values = {"degree_id": degree.id, "year_id": year.id,
                  "weekly_hours": item["weekly_hours"],
                  "enrolled_students": item["enrolled_students"],
                  "requires_lab": item["requires_lab"]}
        course = get_or_create(session, Course, {"semester_id": semester.id, "name": item["name"]}, values)
        assigned = {t.identifier for t in course.teachers}
        for identifier in item["teacher_ids"]:
            if identifier not in assigned:
                course.teachers.append(teachers[identifier])
                assigned.add(identifier)

def seed(paths):
    datasets = []
    for path in paths:
        with Path(path).open(encoding="utf-8") as file:
            data = json.load(file)
        validate(data)
        datasets.append(data)
    degree_names = [d["degree"]["name"] for d in datasets]
    unique(degree_names, "degree name across input files")

    missing = REQUIRED_TABLES - set(inspect(engine).get_table_names())
    if missing:
        raise RuntimeError(f"Missing database tables: {sorted(missing)}")

    # One transaction for all selected degree files; any conflict rolls back everything.
    with SessionLocal() as session:
        with session.begin():
            for data in datasets:
                load_dataset(session, data)
    for data in datasets:
        print(f"Loaded {data['degree']['name']}: {len(data['courses'])} courses, "
              f"{len(data['teachers'])} teachers, {len(data['rooms'])} rooms")
    print("Existing records reused; conflicting records rejected. Transaction committed.")

def main():
    parser = argparse.ArgumentParser(description="Seed one or more degree datasets")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--file", type=Path, action="append", help="JSON dataset (repeatable)")
    selection.add_argument("--all", action="store_true", help="Load all *.json files in data/")
    args = parser.parse_args()
    paths = sorted(DATA_DIR.glob("*.json")) if args.all else (args.file or [DATA_DIR / "ai_cs.json"])
    if not paths:
        parser.error("No JSON datasets found")
    seed(paths)

if __name__ == "__main__":
    main()
