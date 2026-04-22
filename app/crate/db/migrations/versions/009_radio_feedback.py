"""radio_feedback table for persistent like/dislike history

Revision ID: 009
Revises: 008
"""

from alembic import op
import sqlalchemy as sa


revision = "009"
down_revision = "008"


def upgrade() -> None:
    op.create_table(
        "radio_feedback",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("track_id", sa.Integer, nullable=False),
        sa.Column("action", sa.Text, nullable=False),  # 'like' | 'dislike'
        sa.Column("bliss_vector", sa.ARRAY(sa.Float)),
        sa.Column("session_seed", sa.Text),  # what radio was playing
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_radio_feedback_user_id", "radio_feedback", ["user_id"])
    op.create_index("ix_radio_feedback_user_action", "radio_feedback", ["user_id", "action"])
    op.create_unique_constraint("uq_radio_feedback_user_track", "radio_feedback", ["user_id", "track_id"])


def downgrade() -> None:
    op.drop_constraint("uq_radio_feedback_user_track", "radio_feedback")
    op.drop_index("ix_radio_feedback_user_action")
    op.drop_index("ix_radio_feedback_user_id")
    op.drop_table("radio_feedback")
