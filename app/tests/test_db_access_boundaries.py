from __future__ import annotations

import ast
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1] / "crate"
DB_ROOT = APP_ROOT / "db"
REFACTORED_MODULES = [
    Path("auth.py"),
    Path("bliss.py"),
    Path("health_check.py"),
    Path("popularity.py"),
    Path("repair.py"),
    Path("telegram.py"),
    Path("genre_taxonomy_inference.py"),
    Path("api/genres.py"),
    Path("api/radio.py"),
    Path("api/settings.py"),
    Path("api/tasks.py"),
]


class _DbBoundaryVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.transport_calls: list[str] = []
        self.facade_imports: list[str] = []

    def visit_Call(self, node: ast.Call) -> None:
        func = node.func
        if isinstance(func, ast.Name) and func.id in {"get_db_ctx", "transaction_scope"}:
            self.transport_calls.append(f"{func.id}:{node.lineno}")
        elif (
            isinstance(func, ast.Attribute)
            and func.attr == "execute"
            and isinstance(func.value, ast.Name)
            and func.value.id in {"cur", "session"}
        ):
            self.transport_calls.append(f"{func.value.id}.execute:{node.lineno}")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module == "crate.db":
            self.facade_imports.append(f"from crate.db import ...:{node.lineno}")
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            if alias.name == "crate.db":
                self.facade_imports.append(f"import crate.db:{node.lineno}")
        self.generic_visit(node)


def _parse_file(path: Path) -> _DbBoundaryVisitor:
    visitor = _DbBoundaryVisitor()
    tree = ast.parse(path.read_text(), filename=str(path))
    visitor.visit(tree)
    return visitor


def test_no_transport_calls_outside_db_package():
    findings: list[str] = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        if "db" in path.parts:
            continue
        visitor = _parse_file(path)
        if visitor.transport_calls:
            findings.append(
                f"{path.relative_to(APP_ROOT)} -> {', '.join(visitor.transport_calls)}"
            )

    assert findings == [], "Direct DB transport leaked outside crate.db:\n" + "\n".join(findings)


def test_refactored_modules_do_not_use_db_mega_facade():
    findings: list[str] = []
    for relative_path in REFACTORED_MODULES:
        path = APP_ROOT / relative_path
        visitor = _parse_file(path)
        if visitor.facade_imports:
            findings.append(
                f"{relative_path} -> {', '.join(visitor.facade_imports)}"
            )

    assert findings == [], "Refactored modules still import the crate.db mega-facade:\n" + "\n".join(findings)


def test_get_db_ctx_is_confined_to_core_and_compat_facade():
    findings: list[str] = []
    allowed_paths = {
        DB_ROOT / "__init__.py",
        DB_ROOT / "core.py",
    }

    for path in sorted(DB_ROOT.rglob("*.py")):
        if path in allowed_paths:
            continue
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == "crate.db.core":
                for alias in node.names:
                    if alias.name == "get_db_ctx":
                        findings.append(f"{path.relative_to(APP_ROOT)} -> import:{node.lineno}")
            elif isinstance(node, ast.Call):
                func = node.func
                if isinstance(func, ast.Name) and func.id == "get_db_ctx":
                    findings.append(f"{path.relative_to(APP_ROOT)} -> get_db_ctx():{node.lineno}")
                elif (
                    isinstance(func, ast.Attribute)
                    and func.attr == "get_db_ctx"
                    and isinstance(func.value, ast.Name)
                ):
                    findings.append(f"{path.relative_to(APP_ROOT)} -> {func.value.id}.get_db_ctx():{node.lineno}")

    assert findings == [], "get_db_ctx should be confined to crate.db.core (+ compat re-export):\n" + "\n".join(findings)
