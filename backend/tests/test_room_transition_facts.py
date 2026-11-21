"""KAN-53: Test room-transition facts generated from slot configuration."""

from datetime import time

import pytest

from app.engine.facts import build_problem
from app.models import SlotConfig


@pytest.mark.parametrize(
    ("block_minutes", "expected_buffer"),
    [(60, 1), (30, 1), (10, 2)],
)
def test_buffer_slots_matches_configured_block_size(
    session, course, block_minutes, expected_buffer
):
    # The required 15-minute gap must round up to complete grid blocks.
    session.add(
        SlotConfig(
            id=1,
            working_days="[0]",
            start_time=time(9),
            end_time=time(12),
            block_minutes=block_minutes,
        )
    )
    session.commit()

    problem = build_problem(session, course.degree_id, course.semester_id)

    assert f"buffer_slots({expected_buffer})." in problem.facts
    assert len(problem.slots) == 180 // block_minutes


def test_default_config_emits_one_buffer_slot(session, course):
    # Generation must also work when slot configuration has not been saved.
    problem = build_problem(session, course.degree_id, course.semester_id)

    assert "buffer_slots(1)." in problem.facts
    assert session.get(SlotConfig, 1) is None
