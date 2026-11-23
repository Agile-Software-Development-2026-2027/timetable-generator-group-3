import pytest

@pytest.fixture
def director_client(auth_client):
    return auth_client("director")

# ── helpers ──────────────────────────────────────────────────────────────────

def put(director_client, **kwargs):
    defaults = {
        "working_days": [0, 1, 2, 3, 4],
        "start_time": "09:00:00",
        "end_time": "18:00:00",
        "block_minutes": 60,
    }
    return director_client.put("/slot-config", json={**defaults, **kwargs})


# ── GET: default config is created lazily ────────────────────────────────────

def test_get_returns_default_config(director_client):
    r = director_client.get("/slot-config")
    assert r.status_code == 200
    body = r.json()
    assert body["working_days"] == [0, 1, 2, 3, 4]
    assert body["start_time"] == "09:00"
    assert body["end_time"] == "18:00"
    assert body["block_minutes"] == 60
    assert body["blocks_per_day"] == 9
    assert body["working_day_names"] == [
        "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"
    ]


def test_get_is_idempotent(director_client):
    director_client.get("/slot-config")
    r = director_client.get("/slot-config")
    assert r.status_code == 200


# ── PUT: valid updates ────────────────────────────────────────────────────────

def test_update_working_days(director_client):
    r = put(director_client, working_days=[0, 1, 2])
    assert r.status_code == 200
    assert r.json()["working_days"] == [0, 1, 2]
    assert r.json()["working_day_names"] == ["Monday", "Tuesday", "Wednesday"]


def test_update_deduplicates_and_sorts_days(director_client):
    r = put(director_client, working_days=[4, 0, 2, 0, 4])
    assert r.status_code == 200
    assert r.json()["working_days"] == [0, 2, 4]


def test_update_block_minutes(director_client):
    r = put(director_client, block_minutes=90)
    assert r.status_code == 200
    assert r.json()["block_minutes"] == 90
    assert r.json()["blocks_per_day"] == 6


def test_update_persists_across_requests(director_client):
    put(director_client, block_minutes=30)
    r = director_client.get("/slot-config")
    assert r.json()["block_minutes"] == 30


def test_blocks_per_day_calculated_correctly(director_client):
    r = put(director_client, start_time="08:00:00", end_time="20:00:00", block_minutes=60)
    assert r.json()["blocks_per_day"] == 12


# ── PUT: validation errors ────────────────────────────────────────────────────

def test_end_before_start_is_rejected(director_client):
    r = put(director_client, start_time="12:00:00", end_time="09:00:00")
    assert r.status_code == 422
    assert "end_time" in r.text.lower() or "after" in r.text.lower()


def test_equal_start_and_end_is_rejected(director_client):
    r = put(director_client, start_time="09:00:00", end_time="09:00:00")
    assert r.status_code == 422


def test_zero_block_minutes_is_rejected(director_client):
    r = put(director_client, block_minutes=0)
    assert r.status_code == 422
    assert "zero" in r.text.lower() or "greater" in r.text.lower()


def test_negative_block_minutes_is_rejected(director_client):
    r = put(director_client, block_minutes=-30)
    assert r.status_code == 422


def test_empty_working_days_is_rejected(director_client):
    r = put(director_client, working_days=[])
    assert r.status_code == 422
    assert "working day" in r.text.lower() or "least one" in r.text.lower()


def test_invalid_weekday_value_is_rejected(director_client):
    r = put(director_client, working_days=[0, 7])
    assert r.status_code == 422


def test_block_longer_than_range_is_rejected(director_client):
    r = put(director_client, start_time="09:00:00", end_time="10:00:00", block_minutes=90)
    assert r.status_code == 422


# ── GET /grid: derives the full slots matrix ──────────────────────────────────

def test_grid_has_correct_days(director_client):
    put(director_client, working_days=[0, 1, 2])
    r = director_client.get("/slot-config/grid")
    assert r.status_code == 200
    assert set(r.json()["grid"].keys()) == {"Monday", "Tuesday", "Wednesday"}


def test_grid_slots_count_matches_blocks_per_day(director_client):
    put(director_client, start_time="09:00:00", end_time="12:00:00", block_minutes=60)
    r = director_client.get("/slot-config/grid")
    grid = r.json()["grid"]
    for day_slots in grid.values():
        assert len(day_slots) == 3


def test_grid_slot_times_are_contiguous(director_client):
    put(director_client, working_days=[0], start_time="09:00:00", end_time="12:00:00", block_minutes=60)
    slots = director_client.get("/slot-config/grid").json()["grid"]["Monday"]
    assert slots[0]["start"] == "09:00"
    assert slots[0]["end"] == "10:00"
    assert slots[1]["start"] == "10:00"
    assert slots[1]["end"] == "11:00"
    assert slots[2]["start"] == "11:00"
    assert slots[2]["end"] == "12:00"


def test_grid_slots_are_indexed_from_zero(director_client):
    put(director_client, working_days=[0], start_time="09:00:00", end_time="11:00:00", block_minutes=60)
    slots = director_client.get("/slot-config/grid").json()["grid"]["Monday"]
    assert [s["index"] for s in slots] == [0, 1]


def test_partial_last_block_is_not_included(director_client):
    put(director_client, working_days=[0], start_time="09:00:00", end_time="10:30:00", block_minutes=60)
    slots = director_client.get("/slot-config/grid").json()["grid"]["Monday"]
    assert len(slots) == 1
    assert slots[0]["end"] == "10:00"


def test_grid_includes_config_summary(director_client):
    r = director_client.get("/slot-config/grid")
    assert "config" in r.json()
    assert "blocks_per_day" in r.json()["config"]
