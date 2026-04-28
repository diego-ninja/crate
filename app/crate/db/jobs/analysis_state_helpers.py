from __future__ import annotations


ALLOWED_STATE_COLUMNS = frozenset({"analysis_state", "bliss_state"})


def validate_state_column(state_column: str) -> str:
    if state_column not in ALLOWED_STATE_COLUMNS:
        raise ValueError(f"Invalid state column: {state_column!r}")
    return state_column


def pipeline_name_for_state_column(state_column: str) -> str:
    return "bliss" if state_column == "bliss_state" else "analysis"


__all__ = [
    "pipeline_name_for_state_column",
    "validate_state_column",
]
