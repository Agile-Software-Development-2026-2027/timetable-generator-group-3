from datetime import time

from app.models import ScheduleSession


def test_roles_see_correct_timetable_versions(session, course, auth_client):
    degree = course.degree_id
    url = f"/timetable/sessions?degree_id={degree}"

    director = auth_client("director")
    teacher = auth_client("teacher")
    student = auth_client("student")

    draft = ScheduleSession(
        course_id=course.id,
        weekday=0,
        start_time=time(9),
        end_time=time(10),
    )
    session.add(draft)
    session.commit()

    # Before publication: draft is visible only to directors.
    assert len(director.get(url).json()) == 1
    assert teacher.get(url).json() == []
    assert student.get(url).json() == []

    # Teachers and students must not request drafts.
    assert teacher.get(url + "&version=draft").status_code == 403
    assert student.get(url + "&version=draft").status_code == 403

    # Publish the draft.
    response = director.post(f"/timetable/publish?degree_id={degree}")
    assert response.status_code == 200, response.text

    assert len(teacher.get(url).json()) == 1
    assert len(student.get(url).json()) == 1
    assert len(director.get(url + "&version=published").json()) == 1

    # Modify the draft after publication.
    draft.start_time = time(11)
    draft.end_time = time(12)
    session.commit()

    # Director sees updated draft.
    director_sessions = director.get(url).json()
    assert director_sessions[0]["start_time"].startswith("11:00")

    # Students and teachers still see the old published snapshot.
    for client in (teacher, student):
        published = client.get(url).json()
        assert len(published) == 1
        assert published[0]["start_time"].startswith("09:00")