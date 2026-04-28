"""Alembic-driven bootstrap helpers for DB init."""

from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)


def run_alembic_upgrade() -> None:
    """Run ``alembic upgrade head`` programmatically."""
    from alembic import command
    from alembic.config import Config

    app_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ini_path = os.path.join(app_dir, "alembic.ini")

    if not os.path.exists(ini_path):
        log.warning("alembic.ini not found at %s — skipping Alembic migrations", ini_path)
        return

    alembic_cfg = Config(ini_path)
    alembic_cfg.set_main_option(
        "script_location",
        os.path.join(app_dir, "crate", "db", "migrations"),
    )

    try:
        command.upgrade(alembic_cfg, "head")
        log.info("Alembic migrations applied successfully (head)")
    except Exception as exc:
        log.error("Alembic migration failed: %s", exc)
        raise


__all__ = ["run_alembic_upgrade"]
