"""Shared result type for tests/e2e/run.py and tests/e2e/scenarios/*.py.

Kept in its own tiny module (rather than defined in run.py) so it has a single, stable import
identity regardless of whether run.py is executed as `__main__` or imported as `run` — Python
would otherwise load two distinct ScenarioResult classes and isinstance() checks would fail.
"""
from __future__ import annotations

import dataclasses


@dataclasses.dataclass
class ScenarioResult:
    status: str  # "OK" | "SKIP" | "FAIL"
    detail: str = ""

    def __post_init__(self) -> None:
        if self.status not in ("OK", "SKIP", "FAIL"):
            raise ValueError(f"invalid ScenarioResult.status: {self.status!r}")
