from __future__ import annotations

from typing import Any


def _normalize_show_text(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def show_dedupe_key(show: dict) -> str:
    return "|".join(
        [
            _normalize_show_text(show.get("artist_name")),
            str(show.get("date") or "").strip(),
            _normalize_show_text(show.get("local_time")),
            _normalize_show_text(show.get("venue")),
            _normalize_show_text(show.get("city")),
            _normalize_show_text(show.get("country_code") or show.get("country")),
        ]
    )


def _show_row_score(show: dict) -> tuple[int, int, int]:
    populated_fields = sum(
        1
        for key in (
            "external_id",
            "lastfm_event_id",
            "local_time",
            "venue",
            "address_line1",
            "city",
            "region",
            "postal_code",
            "country",
            "country_code",
            "latitude",
            "longitude",
            "url",
            "image_url",
            "tickets_url",
            "lastfm_url",
            "lineup",
        )
        if show.get(key)
    )
    source_score = {
        "both": 3,
        "ticketmaster": 2,
        "lastfm": 1,
    }.get(str(show.get("source") or "").strip().lower(), 0)
    attendance_score = int(show.get("lastfm_attendance") or 0)
    return (source_score, populated_fields, attendance_score)


def _merge_show_rows(primary: dict, secondary: dict) -> dict:
    merged = dict(primary)

    for key, value in secondary.items():
        if merged.get(key) in (None, "", [], ()):
            merged[key] = value

    primary_lineup = merged.get("lineup") or []
    secondary_lineup = secondary.get("lineup") or []
    if primary_lineup or secondary_lineup:
        seen = {_normalize_show_text(name) for name in primary_lineup}
        combined = list(primary_lineup)
        for artist_name in secondary_lineup:
            normalized = _normalize_show_text(artist_name)
            if normalized and normalized not in seen:
                combined.append(artist_name)
                seen.add(normalized)
        merged["lineup"] = combined

    primary_source = str(primary.get("source") or "").strip().lower()
    secondary_source = str(secondary.get("source") or "").strip().lower()
    if primary_source and secondary_source and primary_source != secondary_source:
        merged["source"] = "both"

    if secondary.get("lastfm_attendance"):
        merged["lastfm_attendance"] = max(
            int(primary.get("lastfm_attendance") or 0),
            int(secondary.get("lastfm_attendance") or 0),
        )

    return merged


def dedupe_show_rows(shows: list[dict]) -> list[dict]:
    deduped: list[dict] = []
    key_to_index: dict[str, int] = {}

    for show in shows:
        key = show_dedupe_key(show)
        if key in key_to_index:
            existing_index = key_to_index[key]
            existing = deduped[existing_index]
            existing_score = _show_row_score(existing)
            candidate_score = _show_row_score(show)
            if candidate_score > existing_score:
                deduped[existing_index] = _merge_show_rows(show, existing)
            else:
                deduped[existing_index] = _merge_show_rows(existing, show)
            continue

        key_to_index[key] = len(deduped)
        deduped.append(dict(show))

    return deduped


__all__ = ["dedupe_show_rows", "show_dedupe_key"]
