from __future__ import annotations

import ast
from pathlib import Path

import crate.db as db


DB_ROOT = Path(__file__).resolve().parents[1] / "crate" / "db"
FACADE_MODULES = [
    path
    for path in sorted(DB_ROOT.glob("*.py"))
    if path.name not in {"__init__.py", "engine.py", "tx.py"}
]


def _public_functions(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(), filename=str(path))
    return [
        node.name
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and not node.name.startswith("_")
    ]


def test_db_facade_reexports_all_public_top_level_functions():
    missing: list[str] = []
    for path in FACADE_MODULES:
        for name in _public_functions(path):
            if not hasattr(db, name):
                missing.append(f"{path.stem}.{name}")

    assert missing == [], "crate.db is missing public re-exports:\n" + "\n".join(missing)
