#!/usr/bin/env python3
"""Compare the Rust read-only scanner with Crate's Python scan semantics."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app"))

from crate.scan_compare import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
