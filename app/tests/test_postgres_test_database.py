from __future__ import annotations

import os

import psycopg2
import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE, TEST_DB_NAME


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_template_database_is_never_the_default_runtime_target(
    pg_database_factory,
) -> None:
    assert os.environ["CRATE_POSTGRES_DB"] == TEST_DB_NAME
    assert os.environ["CRATE_POSTGRES_DB"] != pg_database_factory.template_database_name


def test_pg_db_uses_an_isolated_clone_of_the_initialized_template(pg_db) -> None:
    del pg_db
    from crate.db.tx import read_scope

    with read_scope() as session:
        database_name = session.execute(text("SELECT current_database()")).scalar_one()
        revision = session.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one()
        admin_count = session.execute(text("SELECT COUNT(*) FROM users")).scalar_one()

    assert database_name != TEST_DB_NAME
    assert database_name.startswith(f"{TEST_DB_NAME}_case_")
    assert revision == "091"
    assert admin_count >= 1
    assert os.environ["CRATE_POSTGRES_DB"] == database_name


def test_postgres_database_factory_rejects_unsafe_drop_names() -> None:
    from tests.postgres_test_database import PostgresTestDatabaseFactory

    factory = PostgresTestDatabaseFactory(
        base_dsn="postgresql://crate:crate@localhost:5432/crate_test",
        database_prefix=TEST_DB_NAME,
    )

    with pytest.raises(ValueError, match="Refusing to manage"):
        factory.drop_database("crate")


def test_postgres_database_factory_clones_do_not_share_writes(
    pg_database_factory,
) -> None:
    first = pg_database_factory.create_clone()
    second = pg_database_factory.create_clone()

    def connect(database_name: str):
        return psycopg2.connect(
            host=os.environ["CRATE_POSTGRES_HOST"],
            port=os.environ["CRATE_POSTGRES_PORT"],
            user=os.environ["CRATE_POSTGRES_USER"],
            password=os.environ["CRATE_POSTGRES_PASSWORD"],
            dbname=database_name,
        )

    try:
        with connect(first) as connection, connection.cursor() as cursor:
            cursor.execute("INSERT INTO library_artists (name) VALUES ('Clone marker')")
        with connect(second) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) FROM library_artists WHERE name = 'Clone marker'"
            )
            assert cursor.fetchone()[0] == 0
        assert first != second
    finally:
        pg_database_factory.drop_database(first)
        pg_database_factory.drop_database(second)
