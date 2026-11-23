from datetime import time

from app.models import ScheduleSession


def test_publication_status_tracks_draft_changes(session, course, auth_client):
    director = auth_client("director")
    degree_id = course.degree_id

    status_url = f"/timetable/publication?degree_id={degree_id}"
    publish_url = f"/timetable/publish?degree_id={degree_id}"

    # Before publication
    response = director.get(status_url)
    assert response.status_code == 200, response.text
    assert response.json()["published_at"] is None
    assert response.json()["published_by"] is None
    assert response.json()["has_unpublished_changes"] is True

    draft = ScheduleSession(
        course_id=course.id,
        weekday=0,
        start_time=time(9),
        end_time=time(10),
    )
    session.add(draft)
    session.commit()

    # First publication
    response = director.post(publish_url)
    assert response.status_code == 200, response.text
    first_status = response.json()
    assert first_status["published_at"] is not None
    assert first_status["published_by"] is not None
    assert first_status["has_unpublished_changes"] is False

    # Edit the draft without publishing
    draft.start_time = time(11)
    draft.end_time = time(12)
    session.commit()

    response = director.get(status_url)
    assert response.status_code == 200, response.text
    assert response.json()["has_unpublished_changes"] is True

    # Republish the updated timetable
    response = director.post(publish_url)
    assert response.status_code == 200, response.text
    assert response.json()["has_unpublished_changes"] is False