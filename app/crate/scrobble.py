"""Direct scrobbling to Last.fm and ListenBrainz.

Called from record_play_event after a track is completed.
Each service requires user-level credentials stored in user_external_identities.
"""

import hashlib
import logging
import time
from datetime import datetime, timezone

import requests

log = logging.getLogger(__name__)

LASTFM_API_URL = "http://ws.audioscrobbler.com/2.0/"
LISTENBRAINZ_API_URL = "https://api.listenbrainz.org/1/submit-listens"


# ── Last.fm ─────────────────────────────────────────────────────

def lastfm_scrobble(
    *,
    api_key: str,
    api_secret: str,
    session_key: str,
    artist: str,
    track: str,
    album: str = "",
    timestamp: int | None = None,
) -> bool:
    """Scrobble a track to Last.fm using a user's session key."""
    if not all([api_key, api_secret, session_key, artist, track]):
        return False

    ts = timestamp or int(time.time())
    params = {
        "method": "track.scrobble",
        "api_key": api_key,
        "sk": session_key,
        "artist": artist,
        "track": track,
        "timestamp": str(ts),
    }
    if album:
        params["album"] = album

    # Generate API signature: md5 of sorted params + secret
    sig_str = "".join(f"{k}{v}" for k, v in sorted(params.items())) + api_secret
    params["api_sig"] = hashlib.md5(sig_str.encode("utf-8")).hexdigest()
    params["format"] = "json"

    try:
        resp = requests.post(LASTFM_API_URL, data=params, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("scrobbles", {}).get("@attr", {}).get("accepted"):
                log.debug("Last.fm scrobble OK: %s - %s", artist, track)
                return True
            log.warning("Last.fm scrobble rejected: %s", data)
        else:
            log.warning("Last.fm scrobble failed (%d): %s", resp.status_code, resp.text[:200])
    except Exception:
        log.warning("Last.fm scrobble error", exc_info=True)
    return False


def lastfm_now_playing(
    *,
    api_key: str,
    api_secret: str,
    session_key: str,
    artist: str,
    track: str,
    album: str = "",
) -> bool:
    """Update Last.fm 'Now Playing' status."""
    if not all([api_key, api_secret, session_key, artist, track]):
        return False

    params = {
        "method": "track.updateNowPlaying",
        "api_key": api_key,
        "sk": session_key,
        "artist": artist,
        "track": track,
    }
    if album:
        params["album"] = album

    sig_str = "".join(f"{k}{v}" for k, v in sorted(params.items())) + api_secret
    params["api_sig"] = hashlib.md5(sig_str.encode("utf-8")).hexdigest()
    params["format"] = "json"

    try:
        resp = requests.post(LASTFM_API_URL, data=params, timeout=10)
        return resp.status_code == 200
    except Exception:
        return False


def lastfm_get_session(api_key: str, api_secret: str, auth_token: str) -> str | None:
    """Exchange a Last.fm auth token for a session key."""
    params = {
        "method": "auth.getSession",
        "api_key": api_key,
        "token": auth_token,
    }
    sig_str = "".join(f"{k}{v}" for k, v in sorted(params.items())) + api_secret
    params["api_sig"] = hashlib.md5(sig_str.encode("utf-8")).hexdigest()
    params["format"] = "json"

    try:
        resp = requests.get(LASTFM_API_URL, params=params, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("session", {}).get("key")
    except Exception:
        log.warning("Last.fm auth.getSession failed", exc_info=True)
    return None


# ── ListenBrainz ────────────────────────────────────────────────

def listenbrainz_scrobble(
    *,
    token: str,
    artist: str,
    track: str,
    album: str = "",
    timestamp: int | None = None,
) -> bool:
    """Submit a listen to ListenBrainz."""
    if not all([token, artist, track]):
        return False

    ts = timestamp or int(time.time())
    payload = {
        "listen_type": "single",
        "payload": [{
            "listened_at": ts,
            "track_metadata": {
                "artist_name": artist,
                "track_name": track,
                **({"release_name": album} if album else {}),
            },
        }],
    }

    try:
        resp = requests.post(
            LISTENBRAINZ_API_URL,
            json=payload,
            headers={"Authorization": f"Token {token}"},
            timeout=10,
        )
        if resp.status_code == 200:
            log.debug("ListenBrainz scrobble OK: %s - %s", artist, track)
            return True
        log.warning("ListenBrainz scrobble failed (%d): %s", resp.status_code, resp.text[:200])
    except Exception:
        log.warning("ListenBrainz scrobble error", exc_info=True)
    return False


def listenbrainz_now_playing(
    *,
    token: str,
    artist: str,
    track: str,
    album: str = "",
) -> bool:
    """Submit 'playing now' to ListenBrainz."""
    if not all([token, artist, track]):
        return False

    payload = {
        "listen_type": "playing_now",
        "payload": [{
            "track_metadata": {
                "artist_name": artist,
                "track_name": track,
                **({"release_name": album} if album else {}),
            },
        }],
    }

    try:
        resp = requests.post(
            LISTENBRAINZ_API_URL,
            json=payload,
            headers={"Authorization": f"Token {token}"},
            timeout=10,
        )
        return resp.status_code == 200
    except Exception:
        return False


# ── Dispatcher ──────────────────────────────────────────────────

def scrobble_play_event(
    user_id: int,
    *,
    artist: str,
    track: str,
    album: str = "",
    timestamp: int | None = None,
):
    """Scrobble to all configured services for the given user. Best-effort, never raises."""
    import os
    from crate.db import get_db_ctx

    try:
        with get_db_ctx() as cur:
            # Get user's scrobble credentials from external identities
            cur.execute("""
                SELECT provider, external_username, metadata_json
                FROM user_external_identities
                WHERE user_id = %s AND provider IN ('lastfm', 'listenbrainz')
                  AND status = 'linked'
            """, (user_id,))
            identities = cur.fetchall()

        for identity in identities:
            provider = identity["provider"]
            metadata = identity.get("metadata_json") or {}

            if provider == "lastfm":
                api_key = os.environ.get("LASTFM_APIKEY", "")
                api_secret = os.environ.get("LASTFM_API_SECRET", "")
                session_key = metadata.get("session_key", "")
                if api_key and api_secret and session_key:
                    lastfm_scrobble(
                        api_key=api_key,
                        api_secret=api_secret,
                        session_key=session_key,
                        artist=artist,
                        track=track,
                        album=album,
                        timestamp=timestamp,
                    )

            elif provider == "listenbrainz":
                lb_token = metadata.get("token", "")
                if lb_token:
                    listenbrainz_scrobble(
                        token=lb_token,
                        artist=artist,
                        track=track,
                        album=album,
                        timestamp=timestamp,
                    )

    except Exception:
        log.debug("scrobble_play_event failed for user %s", user_id, exc_info=True)
