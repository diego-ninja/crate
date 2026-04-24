from __future__ import annotations

import logging

from sqlalchemy import text

from crate.db.tx import transaction_scope

log = logging.getLogger(__name__)


def persist_radio_feedback(
    user_id: int,
    track_id: int,
    action: str,
    bliss_vector: list[float],
    session_seed: str,
) -> None:
    try:
        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    INSERT INTO radio_feedback (user_id, track_id, action, bliss_vector, session_seed)
                    VALUES (:user_id, :track_id, :action, :bliss_vector, :session_seed)
                    ON CONFLICT ON CONSTRAINT uq_radio_feedback_user_track DO UPDATE
                    SET action = :action, bliss_vector = :bliss_vector,
                        session_seed = :session_seed, created_at = now()
                    """
                ),
                {
                    "user_id": user_id,
                    "track_id": track_id,
                    "action": action,
                    "bliss_vector": bliss_vector,
                    "session_seed": session_seed,
                },
            )
    except Exception:
        try:
            with transaction_scope() as session:
                session.execute(
                    text(
                        """
                        INSERT INTO radio_feedback (user_id, track_id, action, bliss_vector, session_seed)
                        VALUES (:user_id, :track_id, :action, :bliss_vector, :session_seed)
                        """
                    ),
                    {
                        "user_id": user_id,
                        "track_id": track_id,
                        "action": action,
                        "bliss_vector": bliss_vector,
                        "session_seed": session_seed,
                    },
                )
        except Exception:
            log.debug("Failed to persist radio feedback", exc_info=True)
