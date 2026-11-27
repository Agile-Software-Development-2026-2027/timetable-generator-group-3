"""KAN-78: optional lunch break in the slot configuration."""
from datetime import time

import pytest

from app.models import Room, SlotConfig

pytestmark = pytest.mark.usefixtures("legacy_director_client")

DAY = {"working_days": [0], "start_time": "08:30", "end_time": "19:30", "block_minutes": 60}


def test_lunch_break_is_saved_and_returned(client):
    response = client.put("/slot-config", json={
        **DAY, "break_start": "13:30", "break_end": "14:30",
    })

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["break_start"], body["break_end"]) == ("13:30", "14:30")
    assert body["blocks_per_day"] == 10  # 11 blocks minus the lunch hour


def test_grid_leaves_out_the_lunch_break_and_keeps_block_positions(client):
    client.put("/slot-config", json={**DAY, "break_start": "13:30", "break_end": "14:30"})

    monday = client.get("/slot-config/grid").json()["grid"]["Monday"]

    starts = [slot["start"] for slot in monday]
    assert "13:30" not in starts
    assert starts[4:6] == ["12:30", "14:30"]
    # The block after lunch keeps its position in the day, so it is not
    # consecutive to the block before lunch.
    assert [slot["index"] for slot in monday][4:6] == [4, 6]


def test_no_lunch_break_by_default(client):
    body = client.put("/slot-config", json=DAY).json()

    assert body["break_start"] is None and body["break_end"] is None
    assert body["blocks_per_day"] == 11


@pytest.mark.parametrize(("change", "message"), [
    ({"break_start": "13:30"}, "both the start and the end"),
    ({"break_start": "14:30", "break_end": "13:30"}, "must end after it starts"),
    ({"break_start": "07:00", "break_end": "08:00"}, "within the daily schedule"),
])
def test_invalid_lunch_breaks_are_rejected(client, change, message):
    response = client.put("/slot-config", json={**DAY, **change})

    assert response.status_code == 422
    assert message in response.text


def test_generation_never_places_a_session_in_or_across_the_lunch_break(
    client, session, course,
):
    # 09:00-14:00 with lunch 11:00-12:00: two 2-hour sessions must avoid it.
    session.add_all([
        SlotConfig(id=1, working_days="[0,1]", start_time=time(9), end_time=time(14),
                   block_minutes=60, break_start=time(11), break_end=time(12)),
        Room(code="MT1", capacity=110),
    ])
    course.session_duration_minutes = 120
    session.commit()

    result = client.post("/timetable/generate", json={
        "degree_id": course.degree_id, "semester_id": course.semester_id,
    })

    assert result.status_code == 200, result.text
    assert result.json()["status"] == "ok"
    for saved in client.get("/timetable/sessions").json():
        assert saved["end_time"] <= "11:00:00" or saved["start_time"] >= "12:00:00"
