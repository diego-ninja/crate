from __future__ import annotations

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CRATE_ROOT = PROJECT_ROOT / "crate"

_ALLOWED_FACADE_IMPORTS = {
    CRATE_ROOT / "db" / "__init__.py",
}

_ALLOWED_LIBRARY_IMPORTS = {
    CRATE_ROOT / "db" / "__init__.py",
    CRATE_ROOT / "db" / "library.py",
}

_ALLOWED_AUTH_IMPORTS = {
    CRATE_ROOT / "db" / "__init__.py",
    CRATE_ROOT / "db" / "auth.py",
}

_ALLOWED_PLAYLIST_IMPORTS = {
    CRATE_ROOT / "db" / "__init__.py",
    CRATE_ROOT / "db" / "playlists.py",
}

_ALLOWED_SHOWS_IMPORTS = {
    CRATE_ROOT / "db" / "__init__.py",
    CRATE_ROOT / "db" / "shows.py",
}

_ALLOWED_USER_LIBRARY_IMPORTS = {
    CRATE_ROOT / "db" / "__init__.py",
    CRATE_ROOT / "db" / "user_library.py",
}

_ALLOWED_SOCIAL_IMPORTS = {
    CRATE_ROOT / "db" / "__init__.py",
    CRATE_ROOT / "db" / "social.py",
}

_ALLOWED_MANAGEMENT_IMPORTS = {
    CRATE_ROOT / "db" / "__init__.py",
    CRATE_ROOT / "db" / "management.py",
}

_ALLOWED_RADIO_IMPORTS = {
    CRATE_ROOT / "db" / "__init__.py",
    CRATE_ROOT / "db" / "radio.py",
}

_ALLOWED_TASK_IMPORTS = {
    CRATE_ROOT / "db" / "__init__.py",
    CRATE_ROOT / "db" / "tasks.py",
}

_ALLOWED_READ_MODELS_IMPORTS = {
    CRATE_ROOT / "db" / "read_models.py",
}

_ALLOWED_ADMIN_SURFACES_IMPORTS = {
    CRATE_ROOT / "db" / "admin_surfaces.py",
}

_ALLOWED_CACHE_IMPORTS = {
    CRATE_ROOT / "db" / "__init__.py",
    CRATE_ROOT / "db" / "cache.py",
}


def _python_files() -> list[Path]:
    return sorted(path for path in CRATE_ROOT.rglob("*.py") if "__pycache__" not in path.parts)


def _relative(path: Path) -> str:
    return str(path.relative_to(PROJECT_ROOT))


def test_runtime_does_not_import_crate_db_facade_directly():
    offenders: list[str] = []

    for path in _python_files():
        if path in _ALLOWED_FACADE_IMPORTS:
            continue
        for line_no, line in enumerate(path.read_text().splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("from crate.db import ") or stripped == "import crate.db" or stripped.startswith("import crate.db as "):
                offenders.append(f"{_relative(path)}:{line_no}: {stripped}")

    assert offenders == [], "Runtime modules must not import the deprecated crate.db facade:\n" + "\n".join(offenders)


def test_runtime_does_not_import_crate_db_library_directly():
    offenders: list[str] = []

    for path in _python_files():
        if path in _ALLOWED_LIBRARY_IMPORTS:
            continue
        for line_no, line in enumerate(path.read_text().splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("from crate.db.library import ") or stripped == "import crate.db.library" or stripped.startswith("import crate.db.library as "):
                offenders.append(f"{_relative(path)}:{line_no}: {stripped}")

    assert offenders == [], "Runtime modules must not import crate.db.library outside compat shims:\n" + "\n".join(offenders)


def test_runtime_does_not_import_crate_db_auth_directly():
    offenders: list[str] = []

    for path in _python_files():
        if path in _ALLOWED_AUTH_IMPORTS:
            continue
        for line_no, line in enumerate(path.read_text().splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("from crate.db.auth import ") or stripped == "import crate.db.auth" or stripped.startswith("import crate.db.auth as "):
                offenders.append(f"{_relative(path)}:{line_no}: {stripped}")

    assert offenders == [], "Runtime modules must not import crate.db.auth outside compat shims:\n" + "\n".join(offenders)


def test_runtime_does_not_import_crate_db_playlists_directly():
    offenders: list[str] = []

    for path in _python_files():
        if path in _ALLOWED_PLAYLIST_IMPORTS:
            continue
        for line_no, line in enumerate(path.read_text().splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("from crate.db.playlists import ") or stripped == "import crate.db.playlists" or stripped.startswith("import crate.db.playlists as "):
                offenders.append(f"{_relative(path)}:{line_no}: {stripped}")

    assert offenders == [], "Runtime modules must not import crate.db.playlists outside compat shims:\n" + "\n".join(offenders)


def test_runtime_does_not_import_crate_db_shows_directly():
    offenders: list[str] = []

    for path in _python_files():
        if path in _ALLOWED_SHOWS_IMPORTS:
            continue
        for line_no, line in enumerate(path.read_text().splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("from crate.db.shows import ") or stripped == "import crate.db.shows" or stripped.startswith("import crate.db.shows as "):
                offenders.append(f"{_relative(path)}:{line_no}: {stripped}")

    assert offenders == [], "Runtime modules must not import crate.db.shows outside compat shims:\n" + "\n".join(offenders)


def test_runtime_does_not_import_crate_db_user_library_directly():
    offenders: list[str] = []

    for path in _python_files():
        if path in _ALLOWED_USER_LIBRARY_IMPORTS:
            continue
        for line_no, line in enumerate(path.read_text().splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("from crate.db.user_library import ") or stripped == "import crate.db.user_library" or stripped.startswith("import crate.db.user_library as "):
                offenders.append(f"{_relative(path)}:{line_no}: {stripped}")

    assert offenders == [], "Runtime modules must not import crate.db.user_library outside compat shims:\n" + "\n".join(offenders)


def test_runtime_does_not_import_crate_db_social_directly():
    offenders: list[str] = []

    for path in _python_files():
        if path in _ALLOWED_SOCIAL_IMPORTS:
            continue
        for line_no, line in enumerate(path.read_text().splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("from crate.db.social import ") or stripped == "import crate.db.social" or stripped.startswith("import crate.db.social as "):
                offenders.append(f"{_relative(path)}:{line_no}: {stripped}")

    assert offenders == [], "Runtime modules must not import crate.db.social outside compat shims:\n" + "\n".join(offenders)


def test_runtime_does_not_import_crate_db_management_directly():
    offenders: list[str] = []

    for path in _python_files():
        if path in _ALLOWED_MANAGEMENT_IMPORTS:
            continue
        for line_no, line in enumerate(path.read_text().splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("from crate.db.management import ") or stripped == "import crate.db.management" or stripped.startswith("import crate.db.management as "):
                offenders.append(f"{_relative(path)}:{line_no}: {stripped}")

    assert offenders == [], "Runtime modules must not import crate.db.management outside compat shims:\n" + "\n".join(offenders)


def test_runtime_does_not_import_crate_db_radio_directly():
    offenders: list[str] = []

    for path in _python_files():
        if path in _ALLOWED_RADIO_IMPORTS:
            continue
        for line_no, line in enumerate(path.read_text().splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("from crate.db.radio import ") or stripped == "import crate.db.radio" or stripped.startswith("import crate.db.radio as "):
                offenders.append(f"{_relative(path)}:{line_no}: {stripped}")

    assert offenders == [], "Runtime modules must not import crate.db.radio outside compat shims:\n" + "\n".join(offenders)


def test_runtime_does_not_import_crate_db_tasks_directly():
    offenders: list[str] = []

    for path in _python_files():
        if path in _ALLOWED_TASK_IMPORTS:
            continue
        for line_no, line in enumerate(path.read_text().splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("from crate.db.tasks import ") or stripped == "import crate.db.tasks" or stripped.startswith("import crate.db.tasks as "):
                offenders.append(f"{_relative(path)}:{line_no}: {stripped}")

    assert offenders == [], "Runtime modules must not import crate.db.tasks outside compat shims:\n" + "\n".join(offenders)


def test_runtime_does_not_import_crate_db_read_models_directly():
    offenders: list[str] = []

    for path in _python_files():
        if path in _ALLOWED_READ_MODELS_IMPORTS:
            continue
        for line_no, line in enumerate(path.read_text().splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("from crate.db.read_models import ") or stripped == "import crate.db.read_models" or stripped.startswith("import crate.db.read_models as "):
                offenders.append(f"{_relative(path)}:{line_no}: {stripped}")

    assert offenders == [], "Runtime modules must not import crate.db.read_models outside its compat facade:\n" + "\n".join(offenders)


def test_runtime_does_not_import_crate_db_admin_surfaces_directly():
    offenders: list[str] = []

    for path in _python_files():
        if path in _ALLOWED_ADMIN_SURFACES_IMPORTS:
            continue
        for line_no, line in enumerate(path.read_text().splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("from crate.db.admin_surfaces import ") or stripped == "import crate.db.admin_surfaces" or stripped.startswith("import crate.db.admin_surfaces as "):
                offenders.append(f"{_relative(path)}:{line_no}: {stripped}")

    assert offenders == [], "Runtime modules must not import crate.db.admin_surfaces outside its compat facade:\n" + "\n".join(offenders)


def test_runtime_does_not_import_crate_db_cache_directly():
    offenders: list[str] = []

    for path in _python_files():
        if path in _ALLOWED_CACHE_IMPORTS:
            continue
        for line_no, line in enumerate(path.read_text().splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("from crate.db.cache import ") or stripped == "import crate.db.cache" or stripped.startswith("import crate.db.cache as "):
                offenders.append(f"{_relative(path)}:{line_no}: {stripped}")

    assert offenders == [], "Runtime modules must not import crate.db.cache outside compat shims:\n" + "\n".join(offenders)


def test_home_module_keeps_sql_in_query_layer():
    source = (CRATE_ROOT / "db" / "home.py").read_text()

    assert "from sqlalchemy import text" not in source
    assert "from crate.db.tx import transaction_scope" not in source


def test_home_queries_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "home.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "read_scope" not in source
    assert "transaction_scope" not in source


def test_home_tracks_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "home_tracks.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "read_scope" not in source
    assert "transaction_scope" not in source


def test_home_builders_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "home_builders.py").read_text()

    assert "from crate.db.queries.home import" not in source
    assert "from crate.db.queries.user_library import" not in source
    assert "from crate.db.releases import" not in source


def test_home_builder_mixes_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "home_builder_mixes.py").read_text()

    assert "from crate.db.home_builder_discovery import" not in source
    assert "from crate.db.releases import" not in source
    assert "from sqlalchemy import" not in source


def test_home_builder_discovery_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "home_builder_discovery.py").read_text()

    assert "from datetime import" not in source
    assert "from crate.db.queries.home import" not in source
    assert "from crate.db.queries.user_library import" not in source
    assert "from crate.genre_taxonomy import" not in source


def test_home_builder_shared_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "home_builder_shared.py").read_text()

    assert "from datetime import" not in source
    assert "import re" not in source
    assert "\ndef _" not in source


def test_home_builder_upcoming_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "home_builder_upcoming.py").read_text()

    assert "from datetime import" not in source
    assert "from crate.db.queries." not in source
    assert "\ndef _" not in source


def test_home_surfaces_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "home_surfaces.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_home_personalized_sections_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "home_personalized_sections.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_read_models_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "read_models.py").read_text()

    assert "from sqlalchemy import text" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_cache_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "cache.py").read_text()

    assert "from sqlalchemy import text" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_import_queue_read_models_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "import_queue_read_models.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_admin_surfaces_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "admin_surfaces.py").read_text()

    assert "from crate.db.health import" not in source
    assert "from crate.db.worker_logs import" not in source
    assert "from crate.db.ops_runtime import" not in source
    assert "from crate.docker_ctl import" not in source


def test_ops_snapshot_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "ops_snapshot.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_ui_snapshot_store_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "ui_snapshot_store.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_ops_snapshot_builders_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "ops_snapshot_builders.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_core_module_avoids_inline_alembic_and_provisioning_details():
    source = (CRATE_ROOT / "db" / "core.py").read_text()

    assert "CREATE ROLE" not in source
    assert "CREATE DATABASE" not in source
    assert "command.upgrade" not in source
    assert "from alembic" not in source


def test_popularity_jobs_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "jobs" / "popularity.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_analysis_jobs_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "jobs" / "analysis.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_analysis_shared_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "jobs" / "analysis_shared.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_analysis_backfill_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "jobs" / "analysis_backfill.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_library_repository_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "library.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "from crate.db.orm.library import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_library_reads_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "library_reads.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_library_catalog_reads_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "library_catalog_reads.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_auth_repository_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "auth.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_auth_users_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "auth_users.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_tasks_repository_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "tasks.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_tasks_mutations_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "tasks_mutations.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_playlists_writes_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "playlists_writes.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_playlists_generation_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "playlists_generation.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_playlists_rule_engine_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "playlists_rule_engine.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_playlists_reads_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "playlists_reads.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_playlists_crud_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "playlists_crud.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_library_writes_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "library_writes.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_library_upserts_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "library_upserts.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_library_entity_upserts_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "library_entity_upserts.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_user_library_repository_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "user_library.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from crate.db.domain_events import" not in source


def test_user_library_mutations_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "user_library_mutations.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_genres_repository_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "genres.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_genres_taxonomy_writes_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "genres_taxonomy_writes.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_shows_repository_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "shows.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_shows_upserts_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "repositories" / "shows_upserts.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "from sqlalchemy.orm import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_user_queries_module_stays_read_only():
    source = (CRATE_ROOT / "db" / "queries" / "user.py").read_text()

    assert "transaction_scope" not in source


def test_auth_queries_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "auth.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_user_library_queries_module_stays_read_only():
    source = (CRATE_ROOT / "db" / "queries" / "user_library.py").read_text()

    assert "transaction_scope" not in source
    assert "from sqlalchemy import" not in source


def test_user_library_stats_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "user_library_stats.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_genres_queries_module_stays_read_only():
    source = (CRATE_ROOT / "db" / "queries" / "genres.py").read_text()

    assert "transaction_scope" not in source
    assert "from sqlalchemy import" not in source
    assert "read_scope" not in source


def test_genres_library_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "genres_library.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_genres_graph_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "genres_graph.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_genres_taxonomy_graph_queries_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "genres_taxonomy_graph.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_bliss_queries_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "bliss.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_bliss_candidates_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "bliss_candidates.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_analytics_queries_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "analytics.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_analytics_overview_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "analytics_overview.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_analytics_surfaces_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "analytics_surfaces.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "optional_scope" not in source


def test_analytics_insights_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "analytics_insights.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_bliss_artists_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "bliss_artists.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_browse_artist_queries_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "browse_artist.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_browse_media_queries_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "browse_media.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_shows_queries_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "shows.py").read_text()

    assert "from datetime import" not in source
    assert "from sqlalchemy import" not in source
    assert "read_scope" not in source


def test_library_schema_section_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "schema_sections" / "library.py").read_text()

    assert "CREATE TABLE" not in source
    assert "CREATE INDEX" not in source
    assert "ALTER TABLE" not in source


def test_paths_module_keeps_sql_in_query_and_repository_layers():
    source = (CRATE_ROOT / "db" / "paths.py").read_text()

    assert "from sqlalchemy import text" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_paths_compute_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "paths_compute.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_paths_scoring_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "paths_scoring.py").read_text()

    assert "from sqlalchemy import" not in source
    assert "transaction_scope" not in source
    assert "read_scope" not in source


def test_paths_queries_module_stays_read_only():
    source = (CRATE_ROOT / "db" / "queries" / "paths.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_paths_graph_queries_facade_stays_thin():
    source = (CRATE_ROOT / "db" / "queries" / "paths_graph_queries.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_social_queries_module_stays_read_only():
    source = (CRATE_ROOT / "db" / "queries" / "social.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source


def test_tasks_queries_module_stays_read_only():
    source = (CRATE_ROOT / "db" / "queries" / "tasks.py").read_text()

    assert "transaction_scope" not in source


def test_management_queries_module_stays_read_only():
    source = (CRATE_ROOT / "db" / "queries" / "management.py").read_text()

    assert "transaction_scope" not in source


def test_radio_queries_module_stays_read_only():
    source = (CRATE_ROOT / "db" / "queries" / "radio.py").read_text()

    assert "transaction_scope" not in source
    assert "read_scope" not in source
    assert "from sqlalchemy import" not in source
