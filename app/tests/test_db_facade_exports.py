from __future__ import annotations

import ast
from pathlib import Path

import crate.db as db


DB_ROOT = Path(__file__).resolve().parents[1] / "crate" / "db"
INIT_PATH = DB_ROOT / "__init__.py"


def _facade_modules() -> list[Path]:
    tree = ast.parse(INIT_PATH.read_text(), filename=str(INIT_PATH))
    modules: set[Path] = set()
    for node in tree.body:
        if not isinstance(node, ast.ImportFrom):
            continue
        module = node.module or ""
        if not module.startswith("crate.db."):
            continue
        relative = module.removeprefix("crate.db.")
        if "." in relative:
            continue
        path = DB_ROOT / f"{relative}.py"
        if path.exists() and path.name not in {"engine.py", "tx.py"}:
            modules.add(path)
    return sorted(modules)


def _public_functions(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(), filename=str(path))
    return [
        node.name
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and not node.name.startswith("_")
    ]


def test_db_facade_reexports_all_public_top_level_functions():
    missing: list[str] = []
    for path in _facade_modules():
        for name in _public_functions(path):
            if not hasattr(db, name):
                missing.append(f"{path.stem}.{name}")

    assert missing == [], "crate.db is missing public re-exports:\n" + "\n".join(missing)
