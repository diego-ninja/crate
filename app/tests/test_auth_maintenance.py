from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
class TestAuthMaintenanceIntegration:
    def test_auth_invite_can_be_consumed_only_up_to_max_uses(self, pg_db):
        inviter = pg_db.create_user("inviter@test.com")
        invite = pg_db.create_auth_invite(inviter["id"], email="guest@test.com", max_uses=1)

        consumed = pg_db.consume_auth_invite(invite["token"])
        consumed_again = pg_db.consume_auth_invite(invite["token"])
        stored = pg_db.get_auth_invite(invite["token"])

        assert consumed is not None
        assert consumed["use_count"] == 1
        assert consumed["accepted_at"] is not None
        assert consumed_again is None
        assert stored["use_count"] == 1
        assert stored["accepted_at"] is not None

    def test_cleanup_expired_sessions_prunes_closed_and_stale_sessions(self, pg_db):
        from crate.db.tx import transaction_scope

        user = pg_db.create_user("cleanup-sessions@test.com")
        now = datetime.now(timezone.utc)

        expired_old = pg_db.create_session("expired-old-session", user["id"], (now - timedelta(days=10)).isoformat())
        expired_recent = pg_db.create_session("expired-recent-session", user["id"], (now - timedelta(days=1)).isoformat())
        revoked_old = pg_db.create_session("revoked-old-session", user["id"], (now + timedelta(days=10)).isoformat())
        revoked_recent = pg_db.create_session("revoked-recent-session", user["id"], (now + timedelta(days=10)).isoformat())
        active = pg_db.create_session("active-session", user["id"], (now + timedelta(days=10)).isoformat())
        stale_history = pg_db.create_session("stale-history-session", user["id"], (now + timedelta(days=10)).isoformat())

        assert expired_old["id"] == "expired-old-session"
        assert active["id"] == "active-session"

        pg_db.revoke_session(revoked_old["id"])
        pg_db.revoke_session(revoked_recent["id"])

        with transaction_scope() as session:
            session.execute(
                text("UPDATE sessions SET revoked_at = :revoked_at WHERE id = :id"),
                {"revoked_at": (now - timedelta(days=10)).isoformat(), "id": revoked_old["id"]},
            )
            session.execute(
                text(
                    """
                    UPDATE sessions
                    SET created_at = :created_at,
                        last_seen_at = :last_seen_at
                    WHERE id = :id
                    """
                ),
                {
                    "created_at": (now - timedelta(days=45)).isoformat(),
                    "last_seen_at": (now - timedelta(days=45)).isoformat(),
                    "id": stale_history["id"],
                },
            )

        deleted = pg_db.cleanup_expired_sessions(max_age_days=3, stale_age_days=30)
        remaining = {session["id"] for session in pg_db.list_sessions(user["id"], include_revoked=True)}

        assert deleted == 3
        assert expired_old["id"] not in remaining
        assert stale_history["id"] not in remaining
        assert revoked_old["id"] not in remaining
        assert expired_recent["id"] in remaining
        assert revoked_recent["id"] in remaining
        assert active["id"] in remaining

    def test_cleanup_ended_jam_rooms_removes_room_and_related_rows(self, pg_db):
        from crate.db.tx import transaction_scope

        host = pg_db.create_user("jam-host@test.com")
        guest = pg_db.create_user("jam-guest@test.com")
        room = pg_db.create_jam_room(host["id"], "Old Room")

        pg_db.upsert_jam_room_member(room["id"], guest["id"])
        pg_db.append_jam_room_event(room["id"], "join", {"role": "guest"}, guest["id"])
        invite = pg_db.create_jam_room_invite(room["id"], host["id"])
        old_ended_at = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
        pg_db.update_jam_room_state(room["id"], status="ended", ended_at=old_ended_at)

        deleted = pg_db.cleanup_ended_jam_rooms(max_age_days=30)

        with transaction_scope() as session:
            invites_left = session.execute(
                text("SELECT COUNT(*) AS cnt FROM jam_room_invites WHERE room_id = :room_id"),
                {"room_id": room["id"]},
            ).mappings().first()["cnt"]

        assert invite["room_id"] == room["id"]
        assert deleted == 1
        assert pg_db.get_jam_room(room["id"]) is None
        assert pg_db.get_jam_room_members(room["id"]) == []
        assert pg_db.list_jam_room_events(room["id"]) == []
        assert invites_left == 0
