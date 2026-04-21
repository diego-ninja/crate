"""Row serialization helpers for SQLAlchemy → API boundary.

After the TIMESTAMPTZ migration, SQLAlchemy returns native Python
datetime/date objects instead of strings. These helpers ensure all
temporal fields are serialized to ISO strings before reaching Pydantic.
"""

from datetime import date, datetime


def serialize_row(row) -> dict:
    """Convert a SQLAlchemy row mapping to a dict with serialized datetimes."""
    d = dict(row)
    for key, val in d.items():
        if isinstance(val, datetime):
            d[key] = val.isoformat()
        elif isinstance(val, date):
            d[key] = val.isoformat()
    return d


def serialize_rows(rows) -> list[dict]:
    """Convert a list of SQLAlchemy row mappings to serialized dicts."""
    return [serialize_row(r) for r in rows]
