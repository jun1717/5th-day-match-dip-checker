#!/usr/bin/env python3
"""Compatibility wrapper for the TypeScript evaluator."""

from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    return subprocess.run(["npm", "run", "evaluate"], cwd=ROOT).returncode


if __name__ == "__main__":
    raise SystemExit(main())
