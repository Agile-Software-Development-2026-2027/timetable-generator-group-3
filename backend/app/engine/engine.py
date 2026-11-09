"""Clingo integration: strict solution first, whole-course partial fallback."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from time import monotonic

from importlib import import_module

from app.engine.facts import Problem

MODEL_PATH = Path(__file__).with_name("model.lp")
SOLVER_BUDGET_SECONDS = 7.0


@dataclass(frozen=True)
class Assignment:
    course_id: int
    room_id: int
    day: int
    slot: int


@dataclass
class Solution:
    assignments: list[Assignment]
    scheduled_ids: set[int]
    timed_out: bool = False


def _run_model(problem: Problem, mode: str, remaining: float) -> Solution | None:
    clingo = import_module("clingo")
    # Use --models=0 for both modes so Clingo searches for the optimal solution
    # (i.e. the room-preference minimisation in model.lp is actually honoured).
    # The on_model callback keeps the last (best) model seen within the time budget.
    ctl = clingo.Control(["--models=0", "--warn=none"])
    ctl.add("base", [], problem.facts + f"\nmode({mode}).\n" + MODEL_PATH.read_text(encoding="utf-8"))
    ctl.ground([("base", [])])

    current: Solution | None = None

    def remember(model) -> None:
        nonlocal current
        atoms = model.symbols(shown=True)
        assignments = [Assignment(*(x.number for x in a.arguments))
                       for a in atoms if a.name == "assign" and len(a.arguments) == 4]
        scheduled = {a.arguments[0].number for a in atoms if a.name == "scheduled"}
        current = Solution(assignments, scheduled)

    # wait/cancel is supported on the solve handle; never run unbounded.
    with ctl.solve(on_model=remember, async_=True) as handle:
        finished = handle.wait(max(0.01, remaining))
        if not finished:
            handle.cancel()
        handle.get()  # ensure cancellation has finished before returning
    if current is not None:
        current.timed_out = not finished
    return current


def solve(problem: Problem) -> Solution | None:
    if not problem.courses:
        return Solution([], set())
    deadline = monotonic() + SOLVER_BUDGET_SECONDS
    slots_per_group = len(problem.slots)
    group_hours: dict[int, int] = {}
    for c in problem.courses:
        group_hours[c.semester_id] = group_hours.get(c.semester_id, 0) + c.weekly_hours

    # Prove impossibility early when a group requires more than its available slots.
    impossible_capacity = any(hours > slots_per_group for hours in group_hours.values())
    if not impossible_capacity:
        strict = _run_model(problem, "strict", deadline - monotonic())
        if strict is not None and len(strict.scheduled_ids) == len(problem.courses):
            return strict
    # Partial model schedules whole courses only. It never drops isolated hours.
    if monotonic() >= deadline:
        return None
    return _run_model(problem, "partial", deadline - monotonic())
