import pytest

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_local_dirty_source_coalesces_then_reopens_after_completion(pg_db):
    from crate.db.repositories.global_catalog_dirty_sources import (
        claim_dirty_sources,
        complete_dirty_source,
        enqueue_local_dirty_source,
    )
    from crate.db.tx import transaction_scope

    entity_uid = "f8690c59-78dc-4a31-b968-c712f902c472"
    with transaction_scope() as session:
        enqueue_local_dirty_source("track", entity_uid, "upsert", session=session)
        enqueue_local_dirty_source("track", entity_uid, "upsert", session=session)

    with transaction_scope() as session:
        claimed = claim_dirty_sources(10, session=session)

    assert len(claimed) == 1
    assert claimed[0]["operation"] == "upsert"

    with transaction_scope() as session:
        complete_dirty_source(
            int(claimed[0]["id"]),
            requested_at=claimed[0]["requested_at"],
            claimed_at=claimed[0]["claimed_at"],
            session=session,
        )
        enqueue_local_dirty_source("track", entity_uid, "delete", session=session)

    with transaction_scope() as session:
        reopened = claim_dirty_sources(10, session=session)

    assert len(reopened) == 1
    assert reopened[0]["operation"] == "delete"


def test_claimed_dirty_source_is_not_claimed_twice_and_failure_keeps_error(pg_db):
    from crate.db.repositories.global_catalog_dirty_sources import (
        claim_dirty_sources,
        enqueue_federated_dirty_source,
        fail_dirty_source,
    )
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        enqueue_federated_dirty_source(
            "album",
            "7d4ba366-12bb-4240-a99a-3ff5e4d9ad4f",
            "peer-album-42",
            "upsert",
            session=session,
        )

    with transaction_scope() as session:
        first_claim = claim_dirty_sources(1, session=session)

    with transaction_scope() as session:
        second_claim = claim_dirty_sources(1, session=session)

    assert len(first_claim) == 1
    assert second_claim == []

    with transaction_scope() as session:
        fail_dirty_source(
            int(first_claim[0]["id"]),
            "peer manifest unavailable",
            requested_at=first_claim[0]["requested_at"],
            claimed_at=first_claim[0]["claimed_at"],
            session=session,
        )

    with transaction_scope() as session:
        retried = claim_dirty_sources(1, session=session)

    assert len(retried) == 1
    assert retried[0]["last_error"] == "peer manifest unavailable"


def test_dependency_failure_is_deferred_until_retry_time_and_reopened_by_update(pg_db):
    from crate.db.repositories.global_catalog_dirty_sources import (
        claim_dirty_sources,
        enqueue_local_dirty_source,
        fail_dirty_source,
    )
    from crate.db.tx import transaction_scope

    entity_uid = "e3f3c2f2-2bb3-4be7-8a5c-53d3b4c40f1d"
    with transaction_scope() as session:
        enqueue_local_dirty_source("track", entity_uid, "upsert", session=session)

    with transaction_scope() as session:
        claimed = claim_dirty_sources(1, session=session)[0]
        fail_dirty_source(
            int(claimed["id"]),
            "Track source is waiting for its canonical artist",
            requested_at=claimed["requested_at"],
            claimed_at=claimed["claimed_at"],
            retry_after_seconds=3600,
            session=session,
        )

    with transaction_scope() as session:
        assert claim_dirty_sources(1, session=session) == []
        enqueue_local_dirty_source("track", entity_uid, "upsert", session=session)

    with transaction_scope() as session:
        reopened = claim_dirty_sources(1, session=session)

    assert len(reopened) == 1
    assert reopened[0]["last_error"] is None


def test_mutation_arriving_during_claim_is_not_completed_by_stale_worker(pg_db):
    from crate.db.repositories.global_catalog_dirty_sources import (
        claim_dirty_sources,
        complete_dirty_source,
        enqueue_local_dirty_source,
    )
    from crate.db.tx import transaction_scope

    entity_uid = "69c2de6d-ef8c-4dc9-ae53-0d2865ad7aad"
    with transaction_scope() as session:
        enqueue_local_dirty_source("track", entity_uid, "upsert", session=session)
    with transaction_scope() as session:
        claimed = claim_dirty_sources(1, session=session)[0]
    with transaction_scope() as session:
        enqueue_local_dirty_source("track", entity_uid, "delete", session=session)
    with transaction_scope() as session:
        complete_dirty_source(
            int(claimed["id"]),
            requested_at=claimed["requested_at"],
            claimed_at=claimed["claimed_at"],
            session=session,
        )
    with transaction_scope() as session:
        next_claim = claim_dirty_sources(1, session=session)

    assert len(next_claim) == 1
    assert next_claim[0]["operation"] == "delete"


def test_stale_claim_lease_is_recovered(pg_db):
    from sqlalchemy import text

    from crate.db.repositories.global_catalog_dirty_sources import (
        claim_dirty_sources,
        enqueue_local_dirty_source,
    )
    from crate.db.tx import transaction_scope

    entity_uid = "7f487f37-f725-4cb6-b548-b7ef88f7fe79"
    with transaction_scope() as session:
        enqueue_local_dirty_source("artist", entity_uid, "upsert", session=session)
    with transaction_scope() as session:
        first = claim_dirty_sources(1, lease_seconds=60, session=session)[0]
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE global_catalog_dirty_sources
                SET claimed_at = NOW() - INTERVAL '2 minutes'
                WHERE id = :source_id
                """
            ),
            {"source_id": first["id"]},
        )
    with transaction_scope() as session:
        recovered = claim_dirty_sources(1, lease_seconds=60, session=session)

    assert len(recovered) == 1
    assert recovered[0]["id"] == first["id"]
    assert recovered[0]["attempts"] == 2
