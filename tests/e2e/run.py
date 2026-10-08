#!/usr/bin/env python3
"""E2E scenario runner for MGate (stdlib only — no pytest/requests dependency on purpose, so
this runs anywhere python3 is available without a venv). See README.md for the scenario status
convention (OK/SKIP/FAIL) and tests/e2e/scenarios/ for the individual scenarios.

Usage:
    python3 tests/e2e/run.py                     # run every scenario in scenarios/
    python3 tests/e2e/run.py --only NAME [NAME…]  # run only the named scenario module(s)
    python3 tests/e2e/run.py --list               # list discovered scenarios and exit
"""
from __future__ import annotations

import argparse
import importlib
import pkgutil
import sys
from pathlib import Path

from scenario_result import ScenarioResult

SCENARIOS_DIR = Path(__file__).parent / "scenarios"


def discover() -> list[str]:
    sys.path.insert(0, str(Path(__file__).parent))
    names = []
    for mod in pkgutil.iter_modules([str(SCENARIOS_DIR)]):
        if mod.name.startswith("_"):
            continue
        names.append(mod.name)
    return sorted(names)


def run_one(name: str) -> ScenarioResult:
    module = importlib.import_module(f"scenarios.{name}")
    if not hasattr(module, "run"):
        return ScenarioResult("FAIL", f"scenarios.{name} has no run() function")
    try:
        result = module.run()
    except Exception as exc:  # noqa: BLE001 - a scenario crashing is itself a FAIL, not a runner bug
        return ScenarioResult("FAIL", f"unhandled exception: {exc!r}")
    if not isinstance(result, ScenarioResult):
        return ScenarioResult("FAIL", f"run() returned {type(result)!r}, expected ScenarioResult")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", nargs="+", metavar="NAME", help="run only these scenario modules")
    parser.add_argument("--list", action="store_true", help="list discovered scenarios and exit")
    args = parser.parse_args()

    all_names = discover()
    if args.list:
        for n in all_names:
            print(n)
        return 0

    names = args.only if args.only else all_names
    unknown = [n for n in names if n not in all_names]
    if unknown:
        print(f"error: unknown scenario(s): {', '.join(unknown)}", file=sys.stderr)
        print(f"available: {', '.join(all_names)}", file=sys.stderr)
        return 2

    counts = {"OK": 0, "SKIP": 0, "FAIL": 0}
    for name in names:
        result = run_one(name)
        counts[result.status] += 1
        print(f"[{result.status:4}] {name}" + (f": {result.detail}" if result.detail else ""))

    print()
    print(f"e2e: {counts['OK']} ok, {counts['SKIP']} skipped, {counts['FAIL']} failed "
          f"(of {len(names)})")
    return 1 if counts["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
