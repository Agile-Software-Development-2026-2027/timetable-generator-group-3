from __future__ import annotations

from datetime import time

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    ForeignKey,
    Integer,
    String,
    Table,
    Time,
    UniqueConstraint,
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


class Degree(Base):
    __tablename__ = "degree"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)

    years: Mapped[list["Year"]] = relationship(
        back_populates="degree",
        cascade="all, delete-orphan",
        order_by="Year.number",
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
    enrolled_students: Mapped[int] = mapped_column(Integer, nullable=False)
    requires_lab: Mapped[bool] = mapped_column(
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
