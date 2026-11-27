from __future__ import annotations

import uuid
from datetime import datetime, time

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Time,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

course_teacher = Table(
    "course_teacher",
    Base.metadata,
    Column(
        "course_id",
        ForeignKey("course.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "teacher_id",
        ForeignKey("teacher.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)

director_degree = Table(
    "director_degree",
    Base.metadata,
    Column(
        "user_id",
        ForeignKey("app_user.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "degree_id",
        ForeignKey("degree.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)

class Degree(Base):
    __tablename__ = "degree"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)

    years: Mapped[list["Year"]] = relationship(
        back_populates="degree",
        cascade="all, delete-orphan",
        order_by="Year.number",
    )
    directors: Mapped[list["AppUser"]] = relationship(
    secondary=director_degree,
    back_populates="degrees",
)

    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="ck_degree_name_not_empty"),
    )


class Year(Base):
    __tablename__ = "year"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    degree_id: Mapped[int] = mapped_column(
        ForeignKey("degree.id", ondelete="CASCADE"), nullable=False
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)

    degree: Mapped["Degree"] = relationship(back_populates="years")
    semesters: Mapped[list["Semester"]] = relationship(
        back_populates="year",
        cascade="all, delete-orphan",
        order_by="Semester.number",
    )

    __table_args__ = (
        UniqueConstraint("degree_id", "number", name="uq_year_degree_number"),
        CheckConstraint("number > 0", name="ck_year_number_positive"),
    )


class Semester(Base):
    __tablename__ = "semester"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    year_id: Mapped[int] = mapped_column(
        ForeignKey("year.id", ondelete="CASCADE"), nullable=False
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)

    year: Mapped["Year"] = relationship(back_populates="semesters")
    courses: Mapped[list["Course"]] = relationship(
        back_populates="semester",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("year_id", "number", name="uq_semester_year_number"),
        CheckConstraint("number > 0", name="ck_semester_number_positive"),
    )


class Course(Base):
    __tablename__ = "course"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    degree_id: Mapped[int] = mapped_column(
        ForeignKey("degree.id", ondelete="RESTRICT"), nullable=False
    )
    year_id: Mapped[int] = mapped_column(
        ForeignKey("year.id", ondelete="RESTRICT"), nullable=False
    )
    semester_id: Mapped[int] = mapped_column(
        ForeignKey("semester.id", ondelete="CASCADE"), nullable=False
    )

    weekly_hours: Mapped[int] = mapped_column(Integer, nullable=False)
    session_duration_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=60,
        server_default="60"
    )
    enrolled_students: Mapped[int] = mapped_column(Integer, nullable=False)

    requires_lab: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    requires_projector: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    semester: Mapped["Semester"] = relationship(back_populates="courses")
    teachers: Mapped[list["Teacher"]] = relationship(
        secondary=course_teacher,
        back_populates="courses",
    )

    __table_args__ = (
        UniqueConstraint(
            "semester_id", "name", name="uq_course_semester_name"
        ),
        CheckConstraint("weekly_hours > 0", name="ck_course_weekly_hours_positive"),
        CheckConstraint(
            "session_duration_minutes > 0",
            name="ck_course_session_duration_positive"
        ),
        CheckConstraint(
            "enrolled_students > 0", name="ck_course_enrolled_students_positive"
        ),
        CheckConstraint("length(trim(name)) > 0", name="ck_course_name_not_empty"),
    )


class Teacher(Base):
    __tablename__ = "teacher"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    identifier: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)

    courses: Mapped[list["Course"]] = relationship(
        secondary=course_teacher,
        back_populates="teachers",
    )

    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="ck_teacher_name_not_empty"),
        CheckConstraint(
            "length(trim(identifier)) > 0", name="ck_teacher_identifier_not_empty"
        ),
    )


class TeacherAvailability(Base):
    """KAN-57: a time range a teacher marks as unavailable or preferred.

    Stored as times, not slot indexes, so entries stay valid when the slot
    configuration changes. The engine maps each range to the slots it overlaps.
    """

    __tablename__ = "teacher_availability"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    teacher_id: Mapped[int] = mapped_column(
        ForeignKey("teacher.id", ondelete="CASCADE"), nullable=False
    )
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    availability_type: Mapped[str] = mapped_column(String(16), nullable=False)

    __table_args__ = (
        CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_availability_weekday"),
        CheckConstraint("start_time < end_time", name="ck_availability_time_order"),
        CheckConstraint(
            "availability_type IN ('unavailable', 'preferred')",
            name="ck_availability_type",
        ),
        Index("ix_teacher_availability_teacher_id", "teacher_id"),
    )


class Room(Base):
    __tablename__ = "room"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)

    has_projector: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    has_computers: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    is_lab: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    __table_args__ = (
        CheckConstraint("capacity > 0", name="ck_room_capacity_positive"),
        CheckConstraint("length(trim(code)) > 0", name="ck_room_code_not_empty"),
    )


class ScheduleSession(Base):
    __tablename__ = "schedule_session"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(
        ForeignKey("course.id", ondelete="CASCADE"), nullable=False
    )
    room_id: Mapped[int | None] = mapped_column(
        ForeignKey("room.id", ondelete="SET NULL")
    )
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)

    course: Mapped["Course"] = relationship()
    room: Mapped["Room | None"] = relationship()

    __table_args__ = (
        CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_schedule_weekday"),
        CheckConstraint("start_time < end_time", name="ck_schedule_time_order"),
    )


class SlotConfig(Base):
    """Singleton row that stores the timetable slot configuration.

    There is always exactly one row (id=1). Use the slot_config endpoints
    to read or update it. The full grid (days x blocks) is derived on the
    fly from these values by the /slot-config/grid endpoint and the engine.

    working_days: JSON-encoded sorted list of weekday integers (0=Mon … 6=Sun).
    block_minutes: length of each time slot in minutes (must be > 0).
    start_time / end_time: the daily range within which blocks are placed.
    """

    __tablename__ = "slot_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    working_days: Mapped[str] = mapped_column(
        String(32), nullable=False, default="[0,1,2,3,4]"
    )
    start_time: Mapped[time] = mapped_column(
        Time, nullable=False, default=time(9, 0)
    )
    end_time: Mapped[time] = mapped_column(
        Time, nullable=False, default=time(18, 0)
    )
    block_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30)

    __table_args__ = (
        CheckConstraint("block_minutes > 0", name="ck_slot_block_minutes_positive"),
        CheckConstraint("id = 1", name="ck_slot_config_singleton"),
    )


class AppUser(Base):
    """Role of a Supabase Auth user in this platform.

    `id` is the same UUID as `auth.users.id` in Supabase. The foreign key to
    `auth.users` and the Row Level Security policy only exist in schema.sql:
    the `auth` schema is not available in the SQLite test database.
    """

    __tablename__ = "app_user"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    degrees: Mapped[list["Degree"]] = relationship(
    secondary=director_degree,
    back_populates="directors",
)

    # KAN-69: the teacher or student record this account belongs to. Deleting
    # that record also deletes this row, so the login loses its role.
    teacher_id: Mapped[int | None] = mapped_column(
        ForeignKey("teacher.id", ondelete="CASCADE"), unique=True
    )
    student_id: Mapped[int | None] = mapped_column(
        ForeignKey("student.id", ondelete="CASCADE"), unique=True
    )
    teacher: Mapped["Teacher | None"] = relationship()
    student: Mapped["Student | None"] = relationship()

    __table_args__ = (
        CheckConstraint(
            "role IN ('director', 'teacher', 'student')", name="ck_app_user_role"
        ),
        # A teacher account points to a teacher, a student account to a
        # student, and a director to neither.
        CheckConstraint(
            "(role = 'director' AND teacher_id IS NULL AND student_id IS NULL)"
            " OR (role = 'teacher' AND teacher_id IS NOT NULL AND student_id IS NULL)"
            " OR (role = 'student' AND student_id IS NOT NULL AND teacher_id IS NULL)",
            name="ck_app_user_linked_record",
        ),
    )


class PublishedSession(Base):
    """Published timetable snapshot visible to teachers and students."""

    __tablename__ = "published_session"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    degree_id: Mapped[int] = mapped_column(
        ForeignKey("degree.id", ondelete="CASCADE"),
        nullable=False,
    )
    course_id: Mapped[int] = mapped_column(
        ForeignKey("course.id", ondelete="CASCADE"),
        nullable=False,
    )
    room_id: Mapped[int | None] = mapped_column(
        ForeignKey("room.id", ondelete="SET NULL"),
    )
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)

    course: Mapped["Course"] = relationship()
    room: Mapped["Room | None"] = relationship()
    degree: Mapped["Degree"] = relationship()

    __table_args__ = (
        CheckConstraint(
            "weekday BETWEEN 0 AND 6",
            name="ck_published_weekday",
        ),
        CheckConstraint(
            "start_time < end_time",
            name="ck_published_time_order",
        ),
    )


class TimetablePublication(Base):
    """Latest publication metadata for each degree."""

    __tablename__ = "timetable_publication"

    degree_id: Mapped[int] = mapped_column(
        ForeignKey("degree.id", ondelete="CASCADE"),
        primary_key=True,
    )
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    published_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )

    degree: Mapped["Degree"] = relationship()
    publisher: Mapped["AppUser"] = relationship()


class Student(Base):
    __tablename__ = "student"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    student_number: Mapped[str] = mapped_column(
        String(32), nullable=False, unique=True
    )
    degree_id: Mapped[int] = mapped_column(
        ForeignKey("degree.id", ondelete="RESTRICT"), nullable=False
    )
    year_id: Mapped[int] = mapped_column(
        ForeignKey("year.id", ondelete="RESTRICT"), nullable=False
    )

    degree: Mapped["Degree"] = relationship()
    year: Mapped["Year"] = relationship()

    enrollments: Mapped[list["Enrollment"]] = relationship(
        back_populates="student",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_student_name_not_empty",
        ),
        CheckConstraint(
            "length(trim(student_number)) > 0",
            name="ck_student_number_not_empty",
        ),
        Index(
            "uq_student_number_ci",
            func.lower(student_number),
            unique=True,
        ),
    )


class Enrollment(Base):
    __tablename__ = "enrollment"

    student_id: Mapped[int] = mapped_column(
        ForeignKey("student.id", ondelete="CASCADE"),
        primary_key=True,
    )
    course_id: Mapped[int] = mapped_column(
        ForeignKey("course.id", ondelete="CASCADE"),
        primary_key=True,
    )
    enrolled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    student: Mapped["Student"] = relationship(
        back_populates="enrollments",
    )
    course: Mapped["Course"] = relationship()
