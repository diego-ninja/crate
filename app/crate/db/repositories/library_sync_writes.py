from __future__ import annotations

from crate.db.repositories.library_writes import upsert_album, upsert_artist, upsert_track
from crate.db.tx import transaction_scope


def upsert_scanned_album(
    *,
    artist_payload: dict,
    album_payload: dict,
    track_payloads: list[dict],
) -> tuple[str, int, set[str]]:
    with transaction_scope() as session:
        artist_name = upsert_artist(artist_payload, session=session)
        album_id = upsert_album({**album_payload, "artist": artist_name}, session=session)

        synced_paths: set[str] = set()
        for track_payload in track_payloads:
            payload = {**track_payload, "album_id": album_id}
            upsert_track(payload, session=session)
            synced_paths.add(payload["path"])

    return artist_name, album_id, synced_paths
