import uuid
from datetime import time
from types import SimpleNamespace

import pytest

from app.models import (
    AppUser,
    Course,
    Degree,
    Enrollment,
    PublishedSession,
    ScheduleSession,
    Semester,
    Student,
    TimetablePublication,
    Year,
)
from app.student_timetable import (
    has_student_timetable_publication,
    list_student_published_sessions,
)


@pytest.fixture()
def timetable_data(session, course):
    home_year = session.get(Year, course.year_id)
    second_semester = Semester(number=2, year_id=home_year.id)
    other_year = Year(number=2, semesters=[Semester(number=1)])
    empty_year = Year(number=3, semesters=[Semester(number=1)])
    home_degree = session.get(Degree, course.degree_id)
    home_degree.years.extend([other_year, empty_year])

    foreign_year = Year(number=1, semesters=[Semester(number=1)])
    foreign_degree = Degree(name="Mathematics", years=[foreign_year])
    session.add_all([second_semester, foreign_degree])
    session.flush()

    def create_course(name, degree_id, year_id, semester_id):
        record = Course(
            name=name,
            degree_id=degree_id,
            year_id=year_id,
            semester_id=semester_id,
            weekly_hours=2,
            enrolled_students=20,
        )
        session.add(record)
        session.flush()
        return record

    assigned = create_course(
        "Programming", home_degree.id, home_year.id, second_semester.id
    )
    unrelated = create_course(
        "Networks", home_degree.id, other_year.id,
        other_year.semesters[0].id,
    )
    elective = create_course(
        "Statistics", foreign_degree.id, foreign_year.id,
        foreign_year.semesters[0].id,
    )
    outsider = create_course(
        "Geometry", foreign_degree.id, foreign_year.id,
        foreign_year.semesters[0].id,
    )

    def create_student(number, year_id):
        student = Student(
            name=f"Student {number}",
            student_number=number,
            degree_id=home_degree.id,
            year_id=year_id,
        )
        session.add(student)
        session.flush()
        return student

    student = create_student("001", home_year.id)
    other_student = create_student("002", home_year.id)
    empty_student = create_student("003", empty_year.id)
    session.add_all([
        Enrollment(student_id=student.id, course_id=elective.id),
        Enrollment(student_id=other_student.id, course_id=outsider.id),
    ])

    def publish(record, weekday, start_hour):
        published = PublishedSession(
            degree_id=record.degree_id,
            course_id=record.id,
            weekday=weekday,
            start_time=time(start_hour),
            end_time=time(start_hour + 1),
        )
        session.add(published)
        session.flush()
        return published

    first = publish(course, 0, 9)
    second = publish(assigned, 1, 10)
    third = publish(elective, 2, 11)
    publish(unrelated, 0, 8)
    publish(outsider, 3, 12)
    session.add(ScheduleSession(
        course_id=course.id,
        weekday=4,
        start_time=time(15),
        end_time=time(16),
    ))
    session.commit()

    return SimpleNamespace(
        student=student,
        other_student=other_student,
        empty_student=empty_student,
        assigned=assigned,
        elective=elective,
        unrelated=unrelated,
        outsider=outsider,
        first=first,
        second=second,
        third=third,
        home_degree=home_degree,
        foreign_degree=foreign_degree,
    )


def test_includes_assigned_courses_from_all_semesters(session, timetable_data):
    data = timetable_data
    rows, total = list_student_published_sessions(session, data.student)
    assert data.first.id in {row.id for row in rows}
    assert data.second.id in {row.id for row in rows}
    assert total == 3


def test_includes_extra_courses_from_other_degrees(session, timetable_data):
    data = timetable_data
    rows, _ = list_student_published_sessions(session, data.student)
    extra = next(row for row in rows if row.course_id == data.elective.id)
    assert extra.course_name == "Statistics"
    assert extra.degree_name == "Mathematics"


def test_excludes_unrelated_courses(session, timetable_data):
    data = timetable_data
    rows, _ = list_student_published_sessions(session, data.student)
    course_ids = {row.course_id for row in rows}
    assert data.unrelated.id not in course_ids
    assert data.outsider.id not in course_ids


def test_isolates_students_extra_enrollments(session, timetable_data):
    data = timetable_data
    rows, _ = list_student_published_sessions(session, data.other_student)
    course_ids = {row.course_id for row in rows}
    assert data.outsider.id in course_ids
    assert data.elective.id not in course_ids


def test_never_returns_draft_sessions(session, timetable_data):
    rows, total = list_student_published_sessions(
        session, timetable_data.student
    )
    assert total == 3
    assert all(row.weekday != 4 for row in rows)


def test_overlapping_enrollment_does_not_duplicate_sessions(
    session, timetable_data
):
    data = timetable_data
    session.add(Enrollment(
        student_id=data.student.id,
        course_id=data.assigned.id,
    ))
    session.commit()

    rows, total = list_student_published_sessions(session, data.student)
    assert total == 3
    assert len({row.id for row in rows}) == 3


def test_pagination_preserves_filtered_total(session, timetable_data):
    data = timetable_data
    first, total = list_student_published_sessions(
        session, data.student, page=1, page_size=2
    )
    second, remaining_total = list_student_published_sessions(
        session, data.student, page=2, page_size=2
    )
    assert [row.id for row in first] == [data.first.id, data.second.id]
    assert [row.id for row in second] == [data.third.id]
    assert total == remaining_total == 3


def test_page_beyond_results_returns_empty_list(session, timetable_data):
    rows, total = list_student_published_sessions(
        session, timetable_data.student, page=10, page_size=2
    )
    assert rows == []
    assert total == 3


def test_orders_sessions_by_weekday_time_and_id(session, timetable_data):
    data = timetable_data
    earlier = PublishedSession(
        degree_id=data.home_degree.id,
        course_id=data.assigned.id,
        weekday=0,
        start_time=time(8),
        end_time=time(9),
    )
    tied = PublishedSession(
        degree_id=data.home_degree.id,
        course_id=data.assigned.id,
        weekday=0,
        start_time=time(9),
        end_time=time(10),
    )
    session.add_all([earlier, tied])
    session.commit()

    rows, total = list_student_published_sessions(session, data.student)
    assert [row.id for row in rows] == [
        earlier.id, data.first.id, tied.id, data.second.id, data.third.id
    ]
    assert total == 5


def test_student_without_courses_has_no_sessions(session, timetable_data):
    rows, total = list_student_published_sessions(
        session, timetable_data.empty_student
    )
    assert rows == []
    assert total == 0


def test_unpublished_home_degree(session, timetable_data):
    assert not has_student_timetable_publication(
        session, timetable_data.student
    )


def test_home_degree_publication_with_no_personal_sessions(
    session, timetable_data
):
    data = timetable_data
    publisher = AppUser(id=uuid.uuid4(), role="director")
    session.add(publisher)
    session.flush()
    session.add(TimetablePublication(
        degree_id=data.home_degree.id,
        published_by=publisher.id,
    ))
    session.commit()

    assert has_student_timetable_publication(session, data.empty_student)
    rows, total = list_student_published_sessions(session, data.empty_student)
    assert rows == []
    assert total == 0


@pytest.mark.parametrize(
    "page,page_size",
    [(0, 100), (-1, 100), (1, 0), (1, -1), (1, 501)],
)
def test_rejects_invalid_pagination(session, timetable_data, page, page_size):
    with pytest.raises(ValueError, match="Invalid timetable pagination"):
        list_student_published_sessions(
            session, timetable_data.student,
            page=page, page_size=page_size,
        )
