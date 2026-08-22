"""Node-to-node federation API endpoints.

All /api/federation/v1/* endpoints require valid Ed25519 node signatures.
The descriptor (/.well-known/crate-node) is public.
"""

from __future__ import annotations

import base64
import asyncio
import hashlib
import json as _json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, cast

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from crate.api import browse_artist as browse_artist_api
from crate.artist_bio import normalize_artist_bio
from crate.api.openapi_responses import error_response
from crate.api.schemas.federation import (
    FederatedPlaybackPrepareBody,
    FederatedPlaybackPrepareResponse,
    PairingAcceptanceV1,
    PairingOfferV1,
)
from crate.db.queries.federation_manifest import (
    get_federation_manifest_revision_row,
    list_federation_manifest_rows,
)
from crate.db.jobs.federation_catalog_changes import (
    catalog_high_water_mark,
    catalog_retention_floor,
    list_catalog_changes,
)
from crate.db.repositories import federation as repo
from crate.db.repositories import federation_trust as trust_repo
from crate.db.repositories.streaming import get_track_delivery_row_by_entity_uid
from crate.federation.authorization import AuthorizationDecision, authorize
from crate.federation.contracts import CAPABILITIES
from crate.federation.identity import build_signed_descriptor, load_private_key
from crate.federation.playback_prepare import (
    PrepareReservation,
    acquire_prepare_reservation,
    record_playback_prepare_request,
    record_playback_prepare_result,
    record_remote_playback_delivery,
)
from crate.federation.pairing import (
    build_ack,
    verify_acceptance,
    verify_offer,
)
from crate.federation.policy import apply_result_limit, entity_is_allowed
from crate.federation.url_policy import FederationURLPolicy
from crate.federation.search import handle_remote_search
from crate.federation.assertions import verify_signed_assertion
from crate.federation.signing import (
    SIGNATURE_VERSION,
    SIGNED_HEADERS,
    sha256_hex,
    validate_timestamp,
    verify_signature,
)
from crate.release_types import classify_release
from crate.streaming.service import inspect_playback_preparation, prepare_playback

log = logging.getLogger(__name__)
_GENRE_SPLIT_RE = re.compile(r"[;,]")
_MANIFEST_AUDIO_KEYS = (
    "bpm",
    "energy",
    "danceability",
    "valence",
    "acousticness",
    "instrumentalness",
)
_MANIFEST_QUALITY_KEYS = (
    "format",
    "bitrate",
    "sample_rate",
    "bit_depth",
    "size_bytes",
)


def _catalog_page_max_bytes() -> int:
    try:
        configured = int(
            os.environ.get("CRATE_FEDERATION_CATALOG_PAGE_MAX_BYTES", "2097152")
        )
    except ValueError:
        configured = 2_097_152
    return max(1_024, min(configured, 16_777_216))


def _cap_catalog_items_by_bytes(
    items: list[dict[str, Any]], *, max_bytes: int
) -> tuple[list[dict[str, Any]], bool]:
    """Bound one catalog page without materializing or retaining the full catalog."""
    budget = max(2, int(max_bytes))
    used = 2  # JSON list brackets.
    bounded: list[dict[str, Any]] = []
    for item in items:
        encoded_size = len(
            _json.dumps(
                item,
                sort_keys=True,
                separators=(",", ":"),
                default=str,
            ).encode("utf-8")
        )
        required = encoded_size + (1 if bounded else 0)
        if required + used > budget:
            if not bounded:
                raise ValueError("single catalog item exceeds the page byte budget")
            return bounded, True
        bounded.append(item)
        used += required
    return bounded, False


router = APIRouter(prefix="/api/federation/v1", tags=["federation"])
well_known = APIRouter(tags=["federation"])

_RESPONSES = {
    401: error_response("Invalid or missing node signature."),
    403: error_response("Peer does not have the required grant."),
}

_LOCAL_ONLY_KEYS = {
    "id",
    "artist_id",
    "album_id",
    "track_id",
    "path",
    "local_path",
    "filename",
    "folder_name",
    "storage_id",
    "slug",
    "artist_slug",
    "album_slug",
    "cover_file",
    "quarantine_task_id",
    "rating",
}


# -- Pydantic request bodies -------------------------------------------------


class SearchBody(BaseModel):
    q: str = ""
    limit: int = Field(default=20, ge=1, le=50)


class StreamTicketBody(BaseModel):
    remote_entity_uid: str
    delivery_policy: Literal["original", "balanced", "data_saver"] = "balanced"
    requesting_node_uid: str
    playback_session: str = ""


class PairingOfferBody(BaseModel):
    challenge: str = ""


class PairingAcceptBody(BaseModel):
    node_uid: str = ""


class KeyRotationBody(BaseModel):
    node_uid: str = ""
    new_key_id: str = ""
    new_public_key: str = ""
    activate_at: datetime
    grace_until: datetime


# -- Signature validation ----------------------------------------------------


def _request_redis(request: Request):
    state = getattr(getattr(request, "app", None), "state", None)
    redis_client = getattr(state, "redis", None) if state is not None else None
    if redis_client is not None:
        return redis_client

    from crate.db.cache_runtime import get_redis

    redis_client = get_redis()
    if redis_client is None:
        raise HTTPException(status_code=503, detail="Redis is required for federation")
    return redis_client


def _peer_public_keys(peer: dict) -> list[dict[str, Any]]:
    normalized = trust_repo.list_peer_verification_keys(str(peer["node_uid"]))
    if normalized:
        return normalized
    public_keys = peer.get("public_keys_json", [])
    if isinstance(public_keys, str):
        return list(_json.loads(public_keys or "[]"))
    return list(public_keys or [])


async def _require_signed_node_request(
    request: Request,
    body_bytes: bytes | None = None,
) -> dict:
    """Validate crate-ed25519-v1 signatures on node-to-node requests.

    POST signatures must be verified against the exact raw request body. FastAPI
    caches parsed bodies, so this can safely read the body after Pydantic parsing.
    """
    if body_bytes is None:
        body_bytes = await request.body() if request.method != "GET" else b""
    return await asyncio.to_thread(_verify_signed_node_request, request, body_bytes)


def _verify_signed_node_request(request: Request, body_bytes: bytes) -> dict:
    """Validate crate-ed25519-v1 signatures on node-to-node requests.

    For GET requests, body_bytes should be b"".
    For POST requests, pass the raw body bytes for body hash verification.
    """
    node_id = request.headers.get("X-Crate-Node-Id")
    if not node_id:
        raise HTTPException(status_code=401, detail="Missing X-Crate-Node-Id header")

    peer = repo.get_peer(node_id)
    if not peer or peer.get("disabled_at") or peer["trust_state"] != "approved":
        raise HTTPException(status_code=403, detail="Peer not approved or disabled")

    sig_version = request.headers.get("X-Crate-Signature-Version")
    if sig_version != SIGNATURE_VERSION:
        raise HTTPException(status_code=401, detail="Unsupported signature version")

    signed_headers = request.headers.get("X-Crate-Signed-Headers")
    if signed_headers != SIGNED_HEADERS:
        raise HTTPException(status_code=401, detail="Unexpected signed headers")

    key_id = request.headers.get("X-Crate-Key-Id")
    timestamp_str = request.headers.get("X-Crate-Timestamp")
    nonce = request.headers.get("X-Crate-Nonce")
    body_sha256_header = request.headers.get("X-Crate-Body-SHA256")
    signature_full = request.headers.get("X-Crate-Signature")

    if not all([key_id, timestamp_str, nonce, body_sha256_header, signature_full]):
        raise HTTPException(status_code=401, detail="Missing signature headers")

    try:
        timestamp = int(timestamp_str or "")
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid timestamp") from exc

    if not validate_timestamp(timestamp):
        raise HTTPException(status_code=401, detail="Timestamp outside allowed skew")

    computed_hash = sha256_hex(body_bytes)
    if computed_hash != body_sha256_header:
        raise HTTPException(status_code=401, detail="Body hash mismatch")

    if not signature_full or not signature_full.startswith("ed25519:"):
        raise HTTPException(status_code=401, detail="Invalid signature format")
    sig_b64 = signature_full.removeprefix("ed25519:")

    matching_key = trust_repo.get_peer_verification_key(str(node_id), str(key_id))
    if matching_key is None:
        matching_key = next(
            (
                pk
                for pk in _peer_public_keys(peer)
                if pk.get("key_id") == key_id
                and pk.get("status") in ("active", "pending", "retiring")
            ),
            None,
        )
    if not matching_key:
        raise HTTPException(status_code=401, detail="Unknown or inactive key ID")

    try:
        public_key_bytes = base64.b64decode(matching_key["public_key"])
        public_key = Ed25519PublicKey.from_public_bytes(public_key_bytes)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid public key") from exc

    host = request.headers.get("host", "")
    content_type = request.headers.get("content-type", "")
    path_with_query = request.url.path
    if request.url.query:
        path_with_query += "?" + request.url.query

    if not verify_signature(
        public_key=public_key,
        method=request.method,
        path_with_query=path_with_query,
        host=host,
        content_type=content_type,
        node_id=node_id,
        key_id=key_id or "",
        timestamp=timestamp,
        nonce=nonce or "",
        body=body_bytes,
        signature_b64=sig_b64,
    ):
        raise HTTPException(status_code=401, detail="Invalid signature")

    from crate.federation.abuse import check_and_record_nonce

    if not check_and_record_nonce(_request_redis(request), nonce or "", node_id):
        raise HTTPException(status_code=401, detail="Nonce already used")

    return peer


def _require_capability(
    peer: dict,
    capability: str,
    *,
    assertion: dict | None = None,
) -> AuthorizationDecision:
    decision = authorize(
        peer=peer,
        grants=repo.get_peer_grants(str(peer["node_uid"])),
        capability=capability,
        subject_hash=str(assertion.get("sub") or "") if assertion else None,
        roles={str(role) for role in assertion.get("roles", [])}
        if assertion
        else set(),
    )
    if not decision.allowed:
        try:
            repo.record_audit_event(
                event_type="authorization.denied",
                status="denied",
                node_uid=peer.get("node_uid"),
                metadata={
                    "capability": capability,
                    "reason": decision.denial_code,
                    "policy_revision": decision.policy_revision,
                },
            )
        except Exception:
            log.warning(
                "Unable to persist federation authorization denial", exc_info=True
            )
        raise HTTPException(
            status_code=403,
            detail=decision.denial_code or "capability_denied",
        )
    return decision


def _peer_has_capability(peer: dict, capability: str) -> bool:
    decision = authorize(
        peer=peer,
        grants=repo.get_peer_grants(str(peer["node_uid"])),
        capability=capability,
        subject_hash=None,
        roles=set(),
    )
    return decision.allowed


def _require_entity_allowed(
    decision: AuthorizationDecision,
    *,
    entity_type: str,
    entity_uid: str,
) -> None:
    if not entity_is_allowed(
        decision,
        entity_type=entity_type,
        entity_uid=entity_uid,
    ):
        raise HTTPException(status_code=404, detail="Federated entity not available")


def _local_node_uid() -> str:
    node = repo.get_local_node()
    if not node:
        raise HTTPException(status_code=503, detail="Local node not configured")
    return str(node["node_uid"])


def _require_user_assertion(
    request: Request,
    peer: dict,
    purpose: str,
    required_capability: str,
) -> dict[str, Any]:
    token = request.headers.get("X-Crate-User-Assertion")
    if not token:
        raise HTTPException(status_code=403, detail="Missing remote user assertion")
    try:
        assertion = verify_signed_assertion(
            token,
            public_keys=_peer_public_keys(peer),
            expected_audience=_local_node_uid(),
            expected_purpose=purpose,
            required_capability=required_capability,
        )
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    subject_hash = str(assertion.get("sub") or "")
    if not subject_hash:
        raise HTTPException(status_code=403, detail="Missing remote subject")

    subject = repo.ensure_remote_subject(
        peer["node_uid"],
        subject_hash,
        roles=list(assertion.get("roles") or []),
    )
    if subject and subject.get("blocked_at"):
        raise HTTPException(status_code=403, detail="Remote subject is blocked")
    return assertion


def _catalog_share_policy() -> dict[str, Any]:
    node = repo.get_local_node()
    if not node:
        return {}
    raw_policy = node.get("policy_json") or {}
    if isinstance(raw_policy, str):
        try:
            return dict(_json.loads(raw_policy or "{}"))
        except ValueError:
            return {}
    return dict(raw_policy)


def _catalog_policy_allows_item(item: dict[str, Any], policy: dict[str, Any]) -> bool:
    catalog_filter = policy.get("catalog_filter") or {}
    expected_scope = catalog_filter.get("share_scope")
    if expected_scope:
        item_scope = item.get("_share_scope") or item.get("share_scope") or "library"
        if item_scope != expected_scope:
            return False

    allowed_entity_uids = set(catalog_filter.get("entity_uids") or [])
    type_key = f"{item.get('entity_type')}_entity_uids"
    allowed_entity_uids.update(catalog_filter.get(type_key) or [])
    if allowed_entity_uids and item.get("remote_entity_uid") not in allowed_entity_uids:
        return False

    denied_entity_uids = set(catalog_filter.get("deny_entity_uids") or [])
    if item.get("remote_entity_uid") in denied_entity_uids:
        return False

    return True


def _catalog_policy_allows_live_search(policy: dict[str, Any]) -> bool:
    catalog_filter = policy.get("catalog_filter") or {}
    expected_scope = catalog_filter.get("share_scope")
    return expected_scope in (None, "", "library")


def _empty_search_response() -> dict[str, list[dict]]:
    return {"artists": [], "albums": [], "tracks": []}


# -- Public descriptor -------------------------------------------------------


@well_known.get("/.well-known/crate-node")
def get_descriptor(request: Request):
    return _build_local_descriptor(request)


def _build_local_descriptor(request: Request) -> dict:
    node = repo.get_local_node()
    if not node:
        raise HTTPException(status_code=503, detail="Local node not configured")
    active_key = trust_repo.get_active_local_key()
    if active_key is None or not active_key.get("private_key_ref"):
        raise HTTPException(
            status_code=503,
            detail="Federation signing key is unavailable",
        )
    configured_capabilities = (
        _json.loads(node["capabilities_json"])
        if isinstance(node["capabilities_json"], str)
        else node["capabilities_json"]
    )
    from crate.federation.global_genres import taxonomy_release_health

    taxonomy_release = taxonomy_release_health()
    published_taxonomy = None
    if taxonomy_release.get("valid"):
        published_taxonomy = {
            "taxonomy_id": taxonomy_release["taxonomy_id"],
            "version": taxonomy_release["version"],
            "digest": taxonomy_release["digest"],
            "key_id": taxonomy_release["key_id"],
            "signature": taxonomy_release["signature"],
        }
    return build_signed_descriptor(
        node_uid=node["node_uid"],
        display_name=node["display_name"],
        api_base_url=node["api_base_url"] or str(request.base_url).rstrip("/"),
        listen_base_url=node["listen_base_url"],
        active_key_id=active_key["key_id"],
        public_keys=trust_repo.list_local_public_keys(),
        capabilities=configured_capabilities or sorted(CAPABILITIES),
        private_key=load_private_key(active_key["key_id"]),
        taxonomy_release=published_taxonomy,
    )


# -- Capabilities / health ---------------------------------------------------


@router.get("/capabilities")
async def get_capabilities(request: Request):
    peer = await _require_signed_node_request(request)
    await asyncio.to_thread(_require_capability, peer, "catalog.search")
    node = await asyncio.to_thread(repo.get_local_node)
    if not node:
        raise HTTPException(status_code=503, detail="Local node not configured")
    caps = (
        _json.loads(node["capabilities_json"])
        if isinstance(node["capabilities_json"], str)
        else node["capabilities_json"]
    )
    return {
        "node_uid": node["node_uid"],
        "name": node["display_name"],
        "capabilities": caps,
    }


@router.get("/health")
async def get_health(request: Request):
    await _require_signed_node_request(request)
    from crate.federation.global_genres import taxonomy_release_health

    taxonomy = await asyncio.to_thread(taxonomy_release_health)
    return {
        "status": "ok" if taxonomy["status"] == "ok" else "degraded",
        "taxonomy": taxonomy,
    }


# -- Search ------------------------------------------------------------------


@router.post("/search")
async def federated_search(body: SearchBody, request: Request):
    peer = await _require_signed_node_request(request)
    assertion = await asyncio.to_thread(
        _require_user_assertion,
        request,
        peer,
        "catalog.search",
        "federation.catalog.search",
    )
    decision = await asyncio.to_thread(
        _require_capability, peer, "catalog.search", assertion=assertion
    )
    policy = await asyncio.to_thread(_catalog_share_policy)
    if not _catalog_policy_allows_live_search(policy):
        return _empty_search_response()
    payload = await asyncio.to_thread(
        handle_remote_search, query=body.q, limit=body.limit
    )
    return _strip_paths(
        apply_result_limit(
            payload,
            requested_limit=body.limit,
            constraints=decision.constraints,
        )
    )


def _strip_paths(result: Any) -> Any:
    if isinstance(result, list):
        return [_strip_paths(item) for item in result]
    if not isinstance(result, dict):
        return result
    return {
        key: _strip_paths(value)
        for key, value in result.items()
        if key not in _LOCAL_ONLY_KEYS
    }


# -- Metadata detail ---------------------------------------------------------


@router.get("/albums/{remote_entity_uid}")
async def federated_album_detail(remote_entity_uid: str, request: Request):
    peer = await _require_signed_node_request(request)
    assertion = await asyncio.to_thread(
        _require_user_assertion,
        request,
        peer,
        "catalog.album.read",
        "federation.catalog.search",
    )
    decision = await asyncio.to_thread(
        _require_capability, peer, "catalog.album.read", assertion=assertion
    )
    _require_entity_allowed(decision, entity_type="album", entity_uid=remote_entity_uid)
    if not _catalog_policy_allows_item(
        {
            "entity_type": "album",
            "remote_entity_uid": remote_entity_uid,
            "_share_scope": "library",
        },
        await asyncio.to_thread(_catalog_share_policy),
    ):
        raise HTTPException(status_code=404, detail="Album not found")
    album = await asyncio.to_thread(_public_album_detail, remote_entity_uid)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    return _strip_paths(album)


@router.get("/artists/{remote_entity_uid}")
async def federated_artist_detail(remote_entity_uid: str, request: Request):
    peer = await _require_signed_node_request(request)
    assertion = await asyncio.to_thread(
        _require_user_assertion,
        request,
        peer,
        "catalog.artist.read",
        "federation.catalog.search",
    )
    decision = await asyncio.to_thread(
        _require_capability, peer, "catalog.artist.read", assertion=assertion
    )
    _require_entity_allowed(
        decision, entity_type="artist", entity_uid=remote_entity_uid
    )
    if not _catalog_policy_allows_item(
        {
            "entity_type": "artist",
            "remote_entity_uid": remote_entity_uid,
            "_share_scope": "library",
        },
        await asyncio.to_thread(_catalog_share_policy),
    ):
        raise HTTPException(status_code=404, detail="Artist not found")
    artist = await asyncio.to_thread(_public_artist_detail, remote_entity_uid)
    if not artist:
        raise HTTPException(status_code=404, detail="Artist not found")
    return _strip_paths(artist)


@router.get("/tracks/{remote_entity_uid}")
async def federated_track_detail(remote_entity_uid: str, request: Request):
    peer = await _require_signed_node_request(request)
    assertion = await asyncio.to_thread(
        _require_user_assertion,
        request,
        peer,
        "catalog.track.read",
        "federation.catalog.search",
    )
    decision = await asyncio.to_thread(
        _require_capability, peer, "catalog.track.read", assertion=assertion
    )
    _require_entity_allowed(decision, entity_type="track", entity_uid=remote_entity_uid)
    if not _catalog_policy_allows_item(
        {
            "entity_type": "track",
            "remote_entity_uid": remote_entity_uid,
            "_share_scope": "library",
        },
        await asyncio.to_thread(_catalog_share_policy),
    ):
        raise HTTPException(status_code=404, detail="Track not found")
    track = await asyncio.to_thread(_public_track_detail, remote_entity_uid)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return _strip_paths(track)


@router.get("/artwork/{remote_entity_uid}")
async def federated_artwork(
    remote_entity_uid: str,
    request: Request,
    size: int | None = Query(None, ge=32, le=1024),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    peer = await _require_signed_node_request(request)
    assertion = await asyncio.to_thread(
        _require_user_assertion,
        request,
        peer,
        "artwork.read",
        "federation.catalog.search",
    )
    decision = await asyncio.to_thread(
        _require_capability, peer, "artwork.read", assertion=assertion
    )
    _require_entity_allowed(decision, entity_type="album", entity_uid=remote_entity_uid)
    return await asyncio.to_thread(
        _serve_federated_album_asset,
        remote_entity_uid,
        size=size,
        image_format=image_format,
        not_found_detail="Artwork not found",
    )


def _serve_federated_album_asset(
    remote_entity_uid: str,
    *,
    size: int | None,
    image_format: str | None,
    not_found_detail: str,
):
    from crate.api._deps import COVER_NAMES
    from crate.api.artwork_delivery import deliver_artwork
    from crate.artwork_variants import ArtworkAsset
    from crate.db.repositories.library import get_library_album_by_entity_uid

    del image_format

    album = get_library_album_by_entity_uid(remote_entity_uid)
    if not album:
        raise HTTPException(status_code=404, detail=not_found_detail)

    album_dir = Path(str(album.get("path") or ""))
    local_original = None
    for cover_name in COVER_NAMES:
        cover = album_dir / cover_name
        if cover.is_file():
            local_original = cover
            break
    return deliver_artwork(
        ArtworkAsset("album-cover", remote_entity_uid),
        requested_size=size,
        local_original=local_original,
        missing_response=Response(status_code=404),
    )


@router.get("/assets/artists/{remote_entity_uid}/photo")
async def federated_artist_photo(
    remote_entity_uid: str,
    request: Request,
    size: int | None = Query(None, ge=32, le=1024),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    peer = await _require_signed_node_request(request)
    assertion = await asyncio.to_thread(
        _require_user_assertion,
        request,
        peer,
        "artist_photo.read",
        "federation.catalog.search",
    )
    decision = await asyncio.to_thread(
        _require_capability, peer, "artwork.read", assertion=assertion
    )
    _require_entity_allowed(
        decision, entity_type="artist", entity_uid=remote_entity_uid
    )
    if not _catalog_policy_allows_item(
        {
            "entity_type": "artist",
            "remote_entity_uid": remote_entity_uid,
            "_share_scope": "library",
        },
        await asyncio.to_thread(_catalog_share_policy),
    ):
        raise HTTPException(status_code=404, detail="Artist photo not found")

    return await asyncio.to_thread(
        _federated_artist_sidecar_image,
        remote_entity_uid,
        candidate_names=_artist_photo_names(),
        artwork_kind="artist-photo",
        size=size,
        image_format=image_format,
        not_found_detail="Artist photo not found",
    )


@router.get("/assets/artists/{remote_entity_uid}/background")
async def federated_artist_background(
    remote_entity_uid: str,
    request: Request,
    size: int | None = Query(None, ge=32, le=2048),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    peer = await _require_signed_node_request(request)
    assertion = await asyncio.to_thread(
        _require_user_assertion,
        request,
        peer,
        "artist_background.read",
        "federation.catalog.search",
    )
    decision = await asyncio.to_thread(
        _require_capability, peer, "artwork.read", assertion=assertion
    )
    _require_entity_allowed(
        decision, entity_type="artist", entity_uid=remote_entity_uid
    )
    if not _catalog_policy_allows_item(
        {
            "entity_type": "artist",
            "remote_entity_uid": remote_entity_uid,
            "_share_scope": "library",
        },
        await asyncio.to_thread(_catalog_share_policy),
    ):
        raise HTTPException(status_code=404, detail="Artist background not found")

    return await asyncio.to_thread(
        _federated_artist_sidecar_image,
        remote_entity_uid,
        candidate_names=_artist_background_names(),
        artwork_kind="artist-background",
        size=size,
        image_format=image_format,
        not_found_detail="Artist background not found",
    )


@router.get("/assets/{entity_type}/{remote_entity_uid}/{asset_name}")
async def federated_asset(
    entity_type: str,
    remote_entity_uid: str,
    asset_name: str,
    request: Request,
    size: int | None = Query(None, ge=32, le=2048),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
):
    peer = await _require_signed_node_request(request)
    assertion = await asyncio.to_thread(
        _require_user_assertion,
        request,
        peer,
        "artwork.read",
        "federation.catalog.search",
    )
    normalized_type = entity_type.strip().lower()
    normalized_asset = asset_name.strip().lower()
    decision = await asyncio.to_thread(
        _require_capability, peer, "artwork.read", assertion=assertion
    )
    _require_entity_allowed(
        decision,
        entity_type=normalized_type,
        entity_uid=remote_entity_uid,
    )
    if not _catalog_policy_allows_item(
        {
            "entity_type": normalized_type,
            "remote_entity_uid": remote_entity_uid,
            "_share_scope": "library",
        },
        await asyncio.to_thread(_catalog_share_policy),
    ):
        raise HTTPException(status_code=404, detail="Asset not found")

    return await asyncio.to_thread(
        _serve_federated_asset,
        normalized_type,
        remote_entity_uid,
        normalized_asset,
        size=size,
        image_format=image_format,
    )


def _serve_federated_asset(
    entity_type: str,
    remote_entity_uid: str,
    asset_name: str,
    *,
    size: int | None,
    image_format: str | None,
):
    if entity_type == "album" and asset_name in {"cover", "artwork"}:
        return _serve_federated_album_asset(
            remote_entity_uid,
            size=size,
            image_format=image_format,
            not_found_detail="Asset not found",
        )
    if entity_type == "artist" and asset_name == "photo":
        return _federated_artist_sidecar_image(
            remote_entity_uid,
            candidate_names=_artist_photo_names(),
            artwork_kind="artist-photo",
            size=size,
            image_format=image_format,
            not_found_detail="Asset not found",
        )
    if entity_type == "artist" and asset_name == "background":
        return _federated_artist_sidecar_image(
            remote_entity_uid,
            candidate_names=_artist_background_names(),
            artwork_kind="artist-background",
            size=size,
            image_format=image_format,
            not_found_detail="Asset not found",
        )
    raise HTTPException(status_code=404, detail="Asset not found")


def _artist_photo_names() -> tuple[str, ...]:
    from crate.api.browse_shared import ARTIST_PHOTO_NAMES

    return tuple(ARTIST_PHOTO_NAMES)


def _artist_background_names() -> tuple[str, ...]:
    return (
        "background.jpg",
        "background.jpeg",
        "background.png",
        "background.webp",
        "fanart.jpg",
        "fanart.jpeg",
        "fanart.png",
        "fanart.webp",
        *_artist_photo_names(),
    )


def _federated_artist_sidecar_image(
    remote_entity_uid: str,
    *,
    candidate_names: tuple[str, ...],
    artwork_kind: str,
    size: int | None,
    image_format: str | None,
    not_found_detail: str,
):
    from crate.api._deps import library_path
    from crate.api.artwork_delivery import deliver_artwork
    from crate.artwork_variants import ArtworkAsset, ArtworkKind
    from crate.db.repositories.library import get_library_artist_by_entity_uid
    from crate.storage_layout import resolve_artist_dir

    del image_format

    artist = get_library_artist_by_entity_uid(remote_entity_uid)
    if not artist:
        raise HTTPException(status_code=404, detail=not_found_detail)

    artist_dir = resolve_artist_dir(
        library_path(),
        artist,
        fallback_name=str(artist.get("name") or ""),
        existing_only=True,
    )
    if not artist_dir or not artist_dir.is_dir():
        raise HTTPException(status_code=404, detail=not_found_detail)

    local_original = None
    for image_name in candidate_names:
        image = artist_dir / image_name
        if image.is_file():
            local_original = image
            break
    return deliver_artwork(
        ArtworkAsset(cast(ArtworkKind, artwork_kind), remote_entity_uid),
        requested_size=size,
        local_original=local_original,
        missing_response=Response(status_code=404),
    )


def _image_media_type(suffix: str) -> str:
    normalized = suffix.lower()
    if normalized == ".png":
        return "image/png"
    if normalized == ".webp":
        return "image/webp"
    return "image/jpeg"


@router.get("/facets/{entity_type}/{remote_entity_uid}/{facet}")
async def federated_json_facet(
    entity_type: str,
    remote_entity_uid: str,
    facet: str,
    request: Request,
):
    peer = await _require_signed_node_request(request)
    assertion = await asyncio.to_thread(
        _require_user_assertion,
        request,
        peer,
        "catalog.facet.read",
        "federation.catalog.search",
    )
    decision = await asyncio.to_thread(
        _require_capability,
        peer,
        _facet_capability(entity_type),
        assertion=assertion,
    )
    _require_entity_allowed(
        decision,
        entity_type=entity_type,
        entity_uid=remote_entity_uid,
    )
    if not _catalog_policy_allows_item(
        {
            "entity_type": entity_type,
            "remote_entity_uid": remote_entity_uid,
            "_share_scope": "library",
        },
        await asyncio.to_thread(_catalog_share_policy),
    ):
        raise HTTPException(status_code=404, detail="Facet not found")

    payload = await asyncio.to_thread(
        _public_facet_payload, entity_type, remote_entity_uid, facet
    )
    if payload is None:
        raise HTTPException(status_code=404, detail="Facet not found")
    return _strip_paths(payload)


def _facet_capability(entity_type: str) -> str:
    if entity_type == "artist":
        return "catalog.artist.read"
    if entity_type == "album":
        return "catalog.album.read"
    if entity_type == "track":
        return "catalog.track.read"
    raise HTTPException(status_code=404, detail="Unsupported entity type")


def _public_facet_payload(
    entity_type: str,
    remote_entity_uid: str,
    facet: str,
) -> dict | None:
    if entity_type == "artist" and facet in {"metadata", "artist_info"}:
        artist = _public_artist_detail(remote_entity_uid)
        if not artist:
            return None
        if facet == "metadata":
            return artist
        return _artist_info_facet(artist)
    if entity_type == "album" and facet in {"metadata", "album_detail"}:
        return _public_album_detail(remote_entity_uid)
    if entity_type == "track" and facet in {"metadata", "track_info"}:
        return _public_track_detail(remote_entity_uid)
    return None


def _artist_info_facet(artist: dict) -> dict:
    payload = {
        "bio": normalize_artist_bio(artist.get("bio")),
        "tags": _json_list(artist.get("tags_json")),
        "similar": _json_list(artist.get("similar_json")),
        "listeners": int(artist.get("listeners") or 0),
        "playcount": int(artist.get("lastfm_playcount") or 0),
        "image_url": artist.get("image_url"),
        "url": artist.get("url") or "",
        "country": artist.get("country"),
        "area": artist.get("area"),
        "formed": artist.get("formed"),
        "ended": artist.get("ended"),
    }
    payload.update(browse_artist_api.build_public_artist_page_facet(artist))
    return payload


def _json_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value:
        try:
            decoded = _json.loads(value)
        except Exception:
            return []
        return decoded if isinstance(decoded, list) else []
    return []


def _public_album_detail(remote_entity_uid: str) -> dict | None:
    from crate.db.repositories.library import (
        get_library_album_by_entity_uid,
        get_library_tracks,
    )

    album = get_library_album_by_entity_uid(remote_entity_uid)
    if not album:
        return None
    tracks = get_library_tracks(int(album["id"]))
    return {
        "entity_uid": album.get("entity_uid"),
        "name": album.get("name"),
        "artist": album.get("artist"),
        "year": album.get("year"),
        "genre": album.get("genre"),
        "track_count": album.get("track_count"),
        "total_duration": album.get("total_duration"),
        "has_cover": bool(album.get("has_cover")),
        "tracks": [
            {
                "entity_uid": track.get("entity_uid"),
                "title": track.get("title") or track.get("filename"),
                "artist": track.get("artist"),
                "album": track.get("album"),
                "duration": track.get("duration"),
                "track_number": track.get("track_number"),
                "disc_number": track.get("disc_number"),
                "format": track.get("format"),
                "year": track.get("year"),
                "genre": track.get("genre"),
            }
            for track in tracks
            if track.get("entity_uid")
        ],
    }


def _public_artist_detail(remote_entity_uid: str) -> dict | None:
    from crate.db.repositories.library import (
        get_library_albums,
        get_library_artist_by_entity_uid,
    )

    artist = get_library_artist_by_entity_uid(remote_entity_uid)
    if not artist:
        return None
    albums = get_library_albums(str(artist["name"]))
    return {
        "entity_uid": artist.get("entity_uid"),
        "name": artist.get("name"),
        "album_count": artist.get("album_count"),
        "track_count": artist.get("track_count"),
        "primary_format": artist.get("primary_format"),
        "has_photo": bool(artist.get("has_photo")),
        "bio": normalize_artist_bio(artist.get("bio")),
        "tags_json": artist.get("tags_json"),
        "similar_json": artist.get("similar_json"),
        "listeners": artist.get("listeners"),
        "lastfm_playcount": artist.get("lastfm_playcount"),
        "image_url": artist.get("image_url"),
        "url": artist.get("url"),
        "country": artist.get("country"),
        "area": artist.get("area"),
        "formed": artist.get("formed"),
        "ended": artist.get("ended"),
        "albums": [
            {
                "entity_uid": album.get("entity_uid"),
                "name": album.get("name"),
                "artist": album.get("artist"),
                "year": album.get("year"),
                "track_count": album.get("track_count"),
                "total_duration": album.get("total_duration"),
                "has_cover": bool(album.get("has_cover")),
            }
            for album in albums
            if album.get("entity_uid")
        ],
    }


def _public_track_detail(remote_entity_uid: str) -> dict | None:
    from crate.db.repositories.library import get_library_track_by_entity_uid

    track = get_library_track_by_entity_uid(remote_entity_uid)
    if not track:
        return None
    return {
        "entity_uid": track.get("entity_uid"),
        "title": track.get("title") or track.get("filename"),
        "artist": track.get("artist"),
        "album": track.get("album"),
        "duration": track.get("duration"),
        "track_number": track.get("track_number"),
        "disc_number": track.get("disc_number"),
        "format": track.get("format"),
        "year": track.get("year"),
        "genre": track.get("genre"),
        "bitrate": track.get("bitrate"),
        "sample_rate": track.get("sample_rate"),
        "bit_depth": track.get("bit_depth"),
    }


@router.get("/albums/{remote_entity_uid}/import-manifest")
async def federated_album_import_manifest(
    remote_entity_uid: str,
    request: Request,
):
    peer = await _require_signed_node_request(request)
    assertion = await asyncio.to_thread(
        _require_user_assertion,
        request,
        peer,
        "import.manifest",
        "federation.import.request",
    )
    decision = await asyncio.to_thread(
        _require_capability, peer, "import.pull", assertion=assertion
    )
    _require_entity_allowed(
        decision,
        entity_type="album",
        entity_uid=remote_entity_uid,
    )
    from crate.federation.imports import (
        build_album_import_manifest,
        sign_import_manifest,
    )

    try:
        manifest = await asyncio.to_thread(
            build_album_import_manifest,
            remote_entity_uid,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    constraints = decision.constraints
    max_bytes = constraints.max_import_bytes if constraints else None
    if max_bytes is not None and int(manifest["total_bytes"]) > max_bytes:
        raise HTTPException(status_code=413, detail="import_size_limit")
    active_key = await asyncio.to_thread(trust_repo.get_active_local_key)
    if not active_key:
        raise HTTPException(
            status_code=503, detail="Federation signing key unavailable"
        )
    return sign_import_manifest(
        manifest,
        key_id=str(active_key["key_id"]),
        private_key=load_private_key(str(active_key["key_id"])),
    )


@router.get("/import-files/{remote_entity_uid}")
async def federated_import_file(remote_entity_uid: str, request: Request):
    peer = await _require_signed_node_request(request)
    assertion = await asyncio.to_thread(
        _require_user_assertion,
        request,
        peer,
        "import.file",
        "federation.import.request",
    )
    decision = await asyncio.to_thread(
        _require_capability, peer, "import.pull", assertion=assertion
    )
    _require_entity_allowed(
        decision,
        entity_type="track",
        entity_uid=remote_entity_uid,
    )
    from crate.api.browse_media import _playback_headers, _stream_resolved_file
    from crate.db.repositories.streaming import get_track_delivery_row_by_entity_uid
    from crate.streaming.service import media_type_for_path, resolve_playback

    track = await asyncio.to_thread(
        get_track_delivery_row_by_entity_uid, remote_entity_uid
    )
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    resolution = await asyncio.to_thread(
        resolve_playback, track, "original", enqueue=False
    )
    if resolution is None:
        raise HTTPException(status_code=404, detail="Track not found")
    max_bytes = decision.constraints.max_import_bytes if decision.constraints else None
    if max_bytes is not None and resolution.file_path.stat().st_size > max_bytes:
        raise HTTPException(status_code=413, detail="import_size_limit")
    return _stream_resolved_file(
        request,
        resolution.file_path,
        media_type=resolution.media_type or media_type_for_path(resolution.file_path),
        extra_headers=_playback_headers(resolution),
        require_auth=False,
    )


# -- Catalog sync ------------------------------------------------------------


@router.get("/catalog/manifest")
async def catalog_manifest(
    request: Request,
    cursor: str = "",
    page: int = 0,
    page_size: int = 100,
):
    peer = await _require_signed_node_request(request)
    decision = await asyncio.to_thread(_require_capability, peer, "catalog.sync")
    capped_page = max(0, page)
    capped_page_size = max(1, min(page_size, 500))
    if (
        decision is not None
        and decision.constraints
        and decision.constraints.max_results is not None
    ):
        capped_page_size = min(
            capped_page_size,
            decision.constraints.max_results,
        )
    genres_allowed = await asyncio.to_thread(
        _peer_has_capability, peer, "catalog.metadata.genres"
    )
    policy = await asyncio.to_thread(_catalog_share_policy)
    snapshot = await asyncio.to_thread(_catalog_manifest_snapshot, policy)
    peer_uid = str(peer["node_uid"])
    after_entity_type = ""
    after_entity_uid = ""
    snapshot_sequence = int(snapshot.get("snapshot_sequence") or 0)
    if cursor:
        from crate.federation.catalog import (
            InvalidCatalogCursor,
            decode_catalog_cursor,
        )

        try:
            decoded = decode_catalog_cursor(cursor, peer_uid=peer_uid)
        except InvalidCatalogCursor as exc:
            raise HTTPException(
                status_code=400,
                detail={"code": "invalid_cursor", "message": str(exc)},
            ) from exc
        if decoded["mode"] != "snapshot":
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "invalid_cursor",
                    "message": "Expected snapshot cursor",
                },
            )
        position = decoded["position"]
        after_entity_type = str(position.get("entity_type") or "")
        after_entity_uid = str(position.get("entity_uid") or "")
        snapshot_sequence = int(position.get("snapshot_sequence") or 0)

    if not cursor:
        # Compatibility for one release. The query remains keyset-based.
        compatibility_items = await asyncio.to_thread(
            _catalog_manifest_items,
            page=page,
            page_size=capped_page_size,
            include_genres=genres_allowed,
        )
        items = compatibility_items
    else:
        items = await asyncio.to_thread(
            _catalog_manifest_items_after,
            after_entity_type=after_entity_type,
            after_entity_uid=after_entity_uid,
            page_size=capped_page_size,
            include_genres=genres_allowed,
        )
    try:
        items, byte_truncated = _cap_catalog_items_by_bytes(
            items,
            max_bytes=_catalog_page_max_bytes(),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=413,
            detail={"code": "catalog_item_too_large", "message": str(exc)},
        ) from exc
    total_items = int(snapshot["total_items"])
    from crate.federation.catalog import encode_catalog_cursor

    snapshot_cursor = encode_catalog_cursor(
        peer_uid=peer_uid,
        mode="delta",
        position={"sequence": snapshot_sequence},
    )
    next_cursor = None
    if items:
        last = items[-1]
        next_cursor = encode_catalog_cursor(
            peer_uid=peer_uid,
            mode="snapshot",
            position={
                "entity_type": last["entity_type"],
                "entity_uid": last["remote_entity_uid"],
                "snapshot_sequence": snapshot_sequence,
            },
        )
    payload = {
        "revision": snapshot["revision"],
        "page": capped_page,
        "page_size": capped_page_size,
        "total_items": total_items,
        "total_pages": (total_items + capped_page_size - 1) // capped_page_size,
        "items": items,
        "next_cursor": next_cursor,
        "snapshot_cursor": snapshot_cursor,
        "snapshot_sequence": snapshot_sequence,
        "has_more": byte_truncated or len(items) == capped_page_size,
    }
    if genres_allowed:
        from crate.genre_taxonomy import get_core_taxonomy_descriptor

        payload["taxonomy"] = get_core_taxonomy_descriptor()
    return payload


@router.get("/catalog/delta")
async def catalog_delta(request: Request, cursor: str = "", limit: int = 100):
    peer = await _require_signed_node_request(request)
    await asyncio.to_thread(_require_capability, peer, "catalog.sync")
    from crate.federation.catalog import (
        InvalidCatalogCursor,
        decode_catalog_cursor,
        encode_catalog_cursor,
    )

    peer_uid = str(peer["node_uid"])
    after_sequence = 0
    if cursor:
        try:
            decoded = decode_catalog_cursor(cursor, peer_uid=peer_uid)
        except InvalidCatalogCursor as exc:
            raise HTTPException(
                status_code=400,
                detail={"code": "invalid_cursor", "message": str(exc)},
            ) from exc
        if decoded["mode"] != "delta":
            raise HTTPException(
                status_code=400,
                detail={"code": "invalid_cursor", "message": "Expected delta cursor"},
            )
        after_sequence = int(decoded["position"].get("sequence") or 0)

    floor = await asyncio.to_thread(catalog_retention_floor)
    if floor and after_sequence < floor - 1:
        raise HTTPException(
            status_code=410,
            detail={
                "code": "full_sync_required",
                "message": "Catalog cursor predates retained changes",
            },
        )

    capped_limit = max(1, min(int(limit), 500))
    changes = await asyncio.to_thread(
        list_catalog_changes,
        after_sequence=after_sequence,
        limit=capped_limit + 1,
    )
    policy = await asyncio.to_thread(_catalog_share_policy)
    items: list[dict[str, Any]] = []
    scanned_sequence = after_sequence
    for change in changes:
        scanned_sequence = int(change["sequence"])
        payload = dict(change.get("payload_json") or {})
        candidate = {
            **payload,
            "entity_type": change["entity_type"],
            "remote_entity_uid": change["entity_uid"],
        }
        if not _catalog_policy_allows_item(candidate, policy):
            continue
        items.append(
            {
                "sequence": scanned_sequence,
                "entity_type": change["entity_type"],
                "remote_entity_uid": change["entity_uid"],
                "operation": change["operation"],
                "payload_revision": change["payload_revision"],
                "payload": payload,
            }
        )
        if len(items) >= capped_limit:
            break

    try:
        items, byte_truncated = _cap_catalog_items_by_bytes(
            items,
            max_bytes=_catalog_page_max_bytes(),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=413,
            detail={"code": "catalog_item_too_large", "message": str(exc)},
        ) from exc
    if byte_truncated and items:
        scanned_sequence = int(items[-1]["sequence"])

    high_water = await asyncio.to_thread(catalog_high_water_mark)
    next_cursor = encode_catalog_cursor(
        peer_uid=peer_uid,
        mode="delta",
        position={"sequence": scanned_sequence},
    )
    digest_input = _json.dumps(
        items, sort_keys=True, separators=(",", ":"), default=str
    )
    return {
        "items": items,
        "operations": items,
        "next_cursor": next_cursor,
        "cursor": next_cursor,
        "has_more": byte_truncated or scanned_sequence < high_water,
        "high_water_mark": high_water,
        "scanned_sequence": scanned_sequence,
        "digest": f"sha256:{hashlib.sha256(digest_input.encode()).hexdigest()}",
    }


def _catalog_manifest_items(
    page: int,
    page_size: int,
    *,
    include_genres: bool = True,
) -> list[dict]:
    after_entity_type = ""
    after_entity_uid = ""
    items: list[dict] = []
    for _ in range(max(0, page) + 1):
        items = _catalog_manifest_items_after(
            after_entity_type=after_entity_type,
            after_entity_uid=after_entity_uid,
            page_size=page_size,
            include_genres=include_genres,
        )
        if not items:
            break
        after_entity_type = str(items[-1]["entity_type"])
        after_entity_uid = str(items[-1]["remote_entity_uid"])
    return items


def _catalog_manifest_items_after(
    *,
    after_entity_type: str,
    after_entity_uid: str,
    page_size: int,
    include_genres: bool = True,
) -> list[dict]:
    policy = _catalog_share_policy()
    policy_params = _catalog_manifest_policy_params(policy)
    rows = list_federation_manifest_rows(
        after_entity_type=after_entity_type,
        after_entity_uid=after_entity_uid,
        limit=page_size,
        policy_params=policy_params,
    )

    items: list[dict] = []
    for row in rows:
        item = dict(row)
        item["entity_uid"] = item["remote_entity_uid"]
        if item["entity_type"] == "album":
            item["release_category"] = classify_release(
                primary_type=item.get("release_group_primary_type"),
                secondary_types=list(item.get("release_group_secondary_types") or []),
                title=str(item.get("title") or ""),
            )
        if include_genres:
            item["genres"] = _manifest_genres(item)
            item["genre_assertions"] = _manifest_genre_assertions(item)
        _normalize_manifest_audio(item)
        _normalize_manifest_quality(item)
        item["facets"] = _manifest_facets(item)
        if not _catalog_policy_allows_item(item, policy):
            continue
        item.pop("_share_scope", None)
        item.pop("updated_at", None)
        item.pop("has_photo", None)
        item.pop("has_cover", None)
        item.pop("genres_json", None)
        item.pop("genre", None)
        items.append(item)
    return items


def _catalog_manifest_snapshot(policy: dict[str, Any]) -> dict[str, Any]:
    """Return a deterministic revision and exact size for one manifest view."""
    policy_params = _catalog_manifest_policy_params(policy)
    row = get_federation_manifest_revision_row(policy_params)

    total_items = int(row["total_items"] or 0)
    snapshot_sequence = catalog_high_water_mark()
    revision_input = _json.dumps(
        {
            "policy": policy_params,
            "total_items": total_items,
            "snapshot_sequence": snapshot_sequence,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return {
        "revision": f"sha256:{hashlib.sha256(revision_input.encode()).hexdigest()}",
        "total_items": total_items,
        "snapshot_sequence": snapshot_sequence,
    }


def _catalog_manifest_policy_params(policy: dict[str, Any]) -> dict[str, Any]:
    catalog_filter = policy.get("catalog_filter") or {}
    expected_scope = catalog_filter.get("share_scope")
    return {
        "share_allowed": expected_scope in (None, "", "library"),
        "allowed_entity_uids": sorted(
            str(value) for value in catalog_filter.get("entity_uids") or []
        ),
        "allowed_artist_uids": sorted(
            str(value) for value in catalog_filter.get("artist_entity_uids") or []
        ),
        "allowed_album_uids": sorted(
            str(value) for value in catalog_filter.get("album_entity_uids") or []
        ),
        "allowed_track_uids": sorted(
            str(value) for value in catalog_filter.get("track_entity_uids") or []
        ),
        "denied_entity_uids": sorted(
            str(value) for value in catalog_filter.get("deny_entity_uids") or []
        ),
    }


def _normalize_manifest_audio(item: dict[str, Any]) -> None:
    for key in _MANIFEST_AUDIO_KEYS:
        value = item.get(key)
        if value is None:
            item.pop(key, None)
            continue
        try:
            item[key] = float(value)
        except (TypeError, ValueError):
            item.pop(key, None)


def _normalize_manifest_quality(item: dict[str, Any]) -> None:
    fmt = str(item.get("format") or "").strip().lower()
    if fmt:
        item["format"] = fmt
    else:
        item.pop("format", None)

    for key in ("bitrate", "sample_rate", "bit_depth", "size_bytes"):
        value = item.get(key)
        if value is None:
            item.pop(key, None)
            continue
        try:
            normalized = int(value)
        except (TypeError, ValueError):
            item.pop(key, None)
            continue
        if normalized <= 0:
            item.pop(key, None)
            continue
        item[key] = normalized


def _manifest_genres(item: dict[str, Any]) -> list[str]:
    genres = item.get("genres_json")
    if isinstance(genres, str):
        try:
            genres = _json.loads(genres)
        except Exception:
            genres = []

    values: list[str] = []
    seen: set[str] = set()
    if isinstance(genres, list):
        for value in genres:
            _append_manifest_genre(values, seen, value)
    _append_manifest_genre(values, seen, item.get("genre"))
    return values


def _append_manifest_genre(values: list[str], seen: set[str], value: Any) -> None:
    if isinstance(value, dict):
        value = value.get("raw_label") or value.get("label") or value.get("name")
    if value is None:
        return
    for part in _GENRE_SPLIT_RE.split(str(value)):
        genre = part.strip().lower()
        if not genre or genre in seen:
            continue
        seen.add(genre)
        values.append(genre)


def _manifest_genre_assertions(item: dict[str, Any]) -> list[dict[str, Any]]:
    """Expose typed core taxonomy evidence alongside legacy ``genres``."""
    from crate.genre_taxonomy import (
        core_genre_uid,
        get_core_taxonomy_descriptor,
        resolve_static_genre_slug,
        split_genre_names,
    )

    descriptor = get_core_taxonomy_descriptor()
    known_slugs = {genre["slug"] for genre in descriptor["genres"]}
    raw_values = item.get("genres_json")
    if isinstance(raw_values, str):
        try:
            raw_values = _json.loads(raw_values)
        except ValueError:
            raw_values = []
    candidates: list[dict[str, Any]] = []
    if isinstance(raw_values, list):
        for value in raw_values:
            if isinstance(value, dict):
                candidates.append(value)
            else:
                candidates.append({"raw_label": value})
    for value in split_genre_names(str(item.get("genre") or "")):
        candidates.append({"raw_label": value})

    assertions: list[dict[str, Any]] = []
    seen: set[str] = set()
    for candidate in candidates:
        raw_label = str(candidate.get("raw_label") or "").strip().lower()
        if not raw_label or raw_label in seen:
            continue
        seen.add(raw_label)
        canonical_slug = resolve_static_genre_slug(raw_label)
        assertion: dict[str, Any] = {
            "raw_label": raw_label,
            "weight": _manifest_genre_weight(candidate.get("weight")),
            "confidence": 1.0,
            "is_direct": True,
        }
        if canonical_slug and canonical_slug in known_slugs:
            assertion.update(
                {
                    "global_genre_uid": core_genre_uid(canonical_slug),
                    "canonical_slug": canonical_slug,
                    "taxonomy": {
                        "id": descriptor["taxonomy_id"],
                        "version": descriptor["version"],
                        "digest": descriptor["digest"],
                    },
                }
            )
        assertions.append(assertion)
    return assertions


def _manifest_genre_weight(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 1.0


def _manifest_facets(item: dict[str, Any]) -> dict[str, dict[str, Any]]:
    entity_type = str(item.get("entity_type") or "")
    revision = _manifest_revision(item)

    if entity_type == "artist":
        has_photo = bool(item.get("has_photo"))
        return {
            "metadata": _facet(True, revision),
            "artist_info": _facet(True, revision),
            "artist_background": _facet(has_photo, revision),
            "artist_photo": _facet(has_photo, revision),
            "artist_shows": _facet(False, revision),
        }
    if entity_type == "album":
        has_cover = bool(item.get("has_cover"))
        return {
            "metadata": _facet(True, revision),
            "album_detail": _facet(True, revision),
            "album_artwork": _facet(has_cover, revision),
        }
    if entity_type == "track":
        return {
            "metadata": _facet(True, revision),
            "track_info": _facet(True, revision),
            "track_analysis": _facet(False, revision),
            "playback": _facet(True, revision),
        }
    return {"metadata": _facet(True, revision)}


def _facet(available: bool, revision: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {"available": bool(available)}
    if revision:
        payload["revision"] = revision
    return payload


def _manifest_revision(item: dict[str, Any]) -> str:
    updated_at = item.get("updated_at")
    isoformat = getattr(updated_at, "isoformat", None)
    if callable(isoformat):
        return str(isoformat())
    return str(int(time.time()))


# -- Pairing -----------------------------------------------------------------


@router.post("/pairing/offers", status_code=202)
def pairing_offer(body: PairingOfferV1, request: Request):
    local_descriptor = _build_local_descriptor(request)
    try:
        offer = verify_offer(
            body.model_dump(mode="json"),
            local_descriptor=local_descriptor,
        )
        FederationURLPolicy().validate_base_url(offer.source_descriptor.api_base_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    existing = trust_repo.get_pairing(offer.pairing_uid)
    serialized_offer = offer.model_dump(mode="json")
    if existing is not None:
        if existing.get("offer_json") != serialized_offer:
            raise HTTPException(status_code=409, detail="Pairing offer replay conflict")
        return {"status": existing["state"], "pairing_uid": offer.pairing_uid}

    source = offer.source_descriptor
    trust_repo.create_pairing(
        pairing_uid=offer.pairing_uid,
        remote_base_url=source.api_base_url,
        remote_node_uid=source.node_uid,
        direction="inbound",
        state="remote_pending",
        local_challenge=offer.challenge,
        negotiated_protocol=source.protocol_version,
        signature_profile=source.signature_profile,
        descriptor_digest=source.descriptor_digest,
        offer_json=serialized_offer,
        expires_at=offer.expires_at,
    )
    for key in source.public_keys:
        trust_repo.upsert_peer_key(
            node_uid=source.node_uid,
            key_id=key.key_id,
            public_key=key.public_key,
            status=key.status,
            not_before=key.not_before,
            not_after=key.not_after,
        )
    repo.upsert_peer(
        node_uid=source.node_uid,
        display_name=source.name,
        api_base_url=source.api_base_url,
        listen_base_url=source.listen_base_url,
        active_key_id=source.active_key_id,
        public_keys_json=[key.model_dump(mode="json") for key in source.public_keys],
        capabilities_json={name: True for name in source.capabilities},
        trust_state="pending",
        direction="inbound",
    )
    return {"status": "remote_pending", "pairing_uid": offer.pairing_uid}


@router.post("/pairing/acceptances")
def pairing_accept(body: PairingAcceptanceV1, request: Request):
    pairing = trust_repo.get_pairing(body.pairing_uid)
    if pairing is None or pairing.get("direction") != "outbound":
        raise HTTPException(status_code=404, detail="Pairing offer not found")
    local_descriptor = _build_local_descriptor(request)
    try:
        acceptance = verify_acceptance(
            body.model_dump(mode="json"),
            pairing_offer=pairing["offer_json"],
            local_descriptor=local_descriptor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    source = acceptance.source_descriptor
    offer = PairingOfferV1.model_validate(pairing["offer_json"])
    for key in source.public_keys:
        trust_repo.upsert_peer_key(
            node_uid=source.node_uid,
            key_id=key.key_id,
            public_key=key.public_key,
            status=key.status,
            not_before=key.not_before,
            not_after=key.not_after,
        )
    repo.upsert_peer(
        node_uid=source.node_uid,
        display_name=source.name,
        api_base_url=source.api_base_url,
        listen_base_url=source.listen_base_url,
        active_key_id=source.active_key_id,
        public_keys_json=[key.model_dump(mode="json") for key in source.public_keys],
        capabilities_json={name: True for name in source.capabilities},
        trust_state="approved",
        direction="outbound",
        default_grant_preset=offer.outbound_grant,
    )
    from crate.federation.grants import resolve_preset

    resolved_grant = resolve_preset(offer.outbound_grant)
    repo.upsert_peer_grant(
        node_uid=source.node_uid,
        principal_selector=f"peer_users:{source.node_uid}",
        preset=offer.outbound_grant,
        capabilities_json=resolved_grant["capabilities"],
        constraints_json=resolved_grant["constraints"],
    )
    if pairing["state"] != "completed":
        trust_repo.update_pairing(
            body.pairing_uid,
            expected_states={"offered", "accepted"},
            state="completed",
            remote_node_uid=source.node_uid,
            remote_challenge=acceptance.challenge,
            acceptance_json=acceptance.model_dump(mode="json"),
            verified_at=datetime.now(timezone.utc),
            completed_at=datetime.now(timezone.utc),
        )
    active_key = trust_repo.get_active_local_key()
    if active_key is None:
        raise HTTPException(
            status_code=503, detail="Federation signing key unavailable"
        )
    return build_ack(
        acceptance=acceptance,
        source_descriptor=local_descriptor,
        private_key=load_private_key(active_key["key_id"]),
    )


@router.post("/key-rotation")
async def key_rotation(body: KeyRotationBody, request: Request):
    peer = await _require_signed_node_request(request)
    if body.node_uid and body.node_uid != peer["node_uid"]:
        raise HTTPException(status_code=403, detail="Cannot rotate another peer key")
    if not body.new_key_id or not body.new_public_key:
        raise HTTPException(
            status_code=400,
            detail="new_key_id and new_public_key are required",
        )
    now = datetime.now(timezone.utc)
    if body.activate_at <= now or body.grace_until <= body.activate_at:
        raise HTTPException(status_code=400, detail="Invalid rotation window")
    try:
        Ed25519PublicKey.from_public_bytes(
            base64.b64decode(body.new_public_key, validate=True)
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="Invalid Ed25519 public key"
        ) from exc

    old_key_id = request.headers.get("X-Crate-Key-Id", "")
    old_key = await asyncio.to_thread(
        trust_repo.get_peer_verification_key, str(peer["node_uid"]), old_key_id
    )
    if old_key is None:
        raise HTTPException(status_code=401, detail="Rotation must use the old key")
    await asyncio.to_thread(
        trust_repo.upsert_peer_key,
        node_uid=str(peer["node_uid"]),
        key_id=old_key_id,
        public_key=old_key["public_key"],
        status="retiring",
        not_before=old_key.get("not_before"),
        not_after=body.grace_until,
    )
    await asyncio.to_thread(
        trust_repo.upsert_peer_key,
        node_uid=str(peer["node_uid"]),
        key_id=body.new_key_id,
        public_key=body.new_public_key,
        status="pending",
        not_before=body.activate_at,
        not_after=None,
    )
    public_keys = await asyncio.to_thread(
        trust_repo.list_peer_public_keys, str(peer["node_uid"])
    )
    await asyncio.to_thread(
        repo.update_peer,
        peer["node_uid"],
        public_keys_json=public_keys,
    )
    await asyncio.to_thread(
        repo.record_audit_event,
        event_type="key.rotation.received",
        status="success",
        node_uid=peer["node_uid"],
        metadata={"new_key_id": body.new_key_id},
    )
    return {"status": "announced", "activate_at": body.activate_at}


# -- Stream tickets ----------------------------------------------------------


@router.post("/stream-tickets")
async def create_stream_ticket(body: StreamTicketBody, request: Request):
    peer = await _require_signed_node_request(request)
    peer_uid = str(peer["node_uid"])
    if body.requesting_node_uid != peer_uid:
        raise HTTPException(status_code=403, detail="requesting_node_uid mismatch")
    assertion = await asyncio.to_thread(
        _require_user_assertion,
        request,
        peer,
        "stream.ticket",
        "federation.stream.play",
    )

    from crate.federation.stream_proxy import create_ticket

    decision = await asyncio.to_thread(
        _require_capability, peer, "stream.proxy", assertion=assertion
    )
    _require_entity_allowed(
        decision,
        entity_type="track",
        entity_uid=body.remote_entity_uid,
    )
    if body.delivery_policy == "original":
        await asyncio.to_thread(
            _require_capability, peer, "stream.original", assertion=assertion
        )
    else:
        await asyncio.to_thread(
            _require_capability, peer, "stream.transcoded", assertion=assertion
        )
    constraints = decision.constraints
    if constraints and constraints.delivery:
        if body.delivery_policy not in constraints.delivery:
            raise HTTPException(status_code=403, detail="delivery_mode_denied")

    ticket = await asyncio.to_thread(
        create_ticket,
        node_uid=peer_uid,
        remote_entity_uid=body.remote_entity_uid,
        delivery_policy=body.delivery_policy,
        subject_hash=str(assertion.get("sub") or ""),
        direction="inbound",
        audience=peer_uid,
        playback_session=body.playback_session or str(assertion.get("jti") or ""),
        range_policy="bytes",
        max_bytes=constraints.daily_stream_bytes if constraints else None,
        grant_uid=str(decision.grant_uid) if decision.grant_uid else None,
        policy_revision=decision.policy_revision,
        assertion_jti=str(assertion.get("jti") or ""),
    )

    await asyncio.to_thread(
        repo.record_audit_event,
        event_type="stream.ticket.created",
        status="success",
        node_uid=peer_uid,
        metadata={
            "ticket_uid": ticket["ticket_uid"],
            "delivery_policy": body.delivery_policy,
        },
    )
    from crate.db.domain_events import append_domain_event

    await asyncio.to_thread(
        append_domain_event,
        "federation.stream.ticket.created",
        {
            "node_uid": peer_uid,
            "ticket_uid": ticket["ticket_uid"],
            "delivery_policy": body.delivery_policy,
        },
        scope="federation.stream",
        subject_key=peer_uid,
    )

    return {
        "ticket_uid": ticket["ticket_uid"],
        "expires_at": str(ticket["expires_at"]),
        "delivery_policy": body.delivery_policy,
        "playback_session": (body.playback_session or str(assertion.get("jti") or "")),
        "stream_url": f"/api/federation/v1/streams/{ticket['ticket_uid']}",
    }


@router.post("/playback/prepare", response_model=FederatedPlaybackPrepareResponse)
async def prepare_playback_variants(
    body: FederatedPlaybackPrepareBody, request: Request
):
    """Best-effort owner-side variant preparation without stream state."""
    peer = await _require_signed_node_request(request)
    peer_uid = str(peer["node_uid"])
    if str(body.requesting_node_uid) != peer_uid:
        raise HTTPException(status_code=403, detail="requesting_node_uid mismatch")

    assertion = await asyncio.to_thread(
        _require_user_assertion,
        request,
        peer,
        "stream.prepare",
        "federation.stream.play",
    )
    decision = await asyncio.to_thread(
        _require_capability, peer, "stream.proxy", assertion=assertion
    )
    await asyncio.to_thread(
        _require_capability, peer, "stream.transcoded", assertion=assertion
    )
    constraints = decision.constraints
    if (
        constraints
        and constraints.delivery
        and body.delivery_policy not in constraints.delivery
    ):
        raise HTTPException(status_code=403, detail="delivery_mode_denied")

    for _remote_entity_uid in body.remote_entity_uids:
        await asyncio.to_thread(record_playback_prepare_request, body.delivery_policy)

    try:
        redis_client = await asyncio.to_thread(_request_redis, request)
    except HTTPException:
        redis_client = None

    items = []
    for remote_entity_uid in body.remote_entity_uids:
        entity_uid = str(remote_entity_uid)
        if not entity_is_allowed(
            decision,
            entity_type="track",
            entity_uid=entity_uid,
        ):
            items.append(
                {"remote_entity_uid": remote_entity_uid, "status": "unavailable"}
            )
            continue

        track = await asyncio.to_thread(
            get_track_delivery_row_by_entity_uid, entity_uid
        )
        if not track:
            items.append(
                {"remote_entity_uid": remote_entity_uid, "status": "unavailable"}
            )
            continue

        inspection = await asyncio.to_thread(
            inspect_playback_preparation, track, body.delivery_policy
        )
        if inspection is None:
            items.append(
                {"remote_entity_uid": remote_entity_uid, "status": "unavailable"}
            )
            continue
        if inspection.ready:
            items.append({"remote_entity_uid": remote_entity_uid, "status": "ready"})
            continue
        if not inspection.cache_key:
            items.append(
                {"remote_entity_uid": remote_entity_uid, "status": "unavailable"}
            )
            continue

        reservation = await asyncio.to_thread(
            acquire_prepare_reservation,
            redis_client,
            peer_uid,
            inspection.cache_key,
        )
        if reservation not in {
            PrepareReservation.ACCEPTED,
            PrepareReservation.DUPLICATE,
        }:
            items.append(
                {"remote_entity_uid": remote_entity_uid, "status": "rate_limited"}
            )
            continue

        resolution = await asyncio.to_thread(
            prepare_playback,
            track,
            body.delivery_policy,
            reason="lookahead",
        )
        status = (
            "ready"
            if resolution and resolution.cache_hit
            else "preparing"
            if resolution and resolution.preparing
            else "unavailable"
        )
        items.append({"remote_entity_uid": remote_entity_uid, "status": status})

    response = FederatedPlaybackPrepareResponse(items=items)
    for item in response.items:
        await asyncio.to_thread(
            record_playback_prepare_result, item.status, body.delivery_policy
        )
    return response


@router.get("/streams/{ticket_uid}")
async def serve_stream(ticket_uid: str, request: Request):
    peer = await _require_signed_node_request(request)

    from crate.api.browse_media import _playback_headers, _stream_resolved_file
    from crate.db.repositories.federation_stream_tickets import get_ticket
    from crate.db.repositories.streaming import get_track_delivery_row_by_entity_uid
    from crate.federation.quotas import (
        DEFAULT_DAILY_BYTES_PER_PEER,
        DEFAULT_DAILY_BYTES_PER_SUBJECT,
        DEFAULT_MAX_STREAMS_PER_PEER,
        DEFAULT_MAX_STREAMS_PER_SUBJECT,
        acquire_stream_slot,
        reconcile_stream_bytes,
        release_stream_slot,
        reserve_stream_bytes,
    )
    from crate.federation.stream_proxy import (
        FederationQuotaResponse,
        requested_byte_count,
        validate_ticket,
    )
    from crate.streaming.service import media_type_for_path, resolve_playback

    preview = await asyncio.to_thread(get_ticket, ticket_uid)
    if not preview:
        raise HTTPException(status_code=404, detail="Ticket not found or expired")
    subject_hash = str(preview.get("subject_hash") or "")
    subject = (
        await asyncio.to_thread(
            repo.get_remote_subject, str(peer["node_uid"]), subject_hash
        )
        or {}
    )
    roles = subject.get("last_roles_json") or []
    if isinstance(roles, str):
        roles = _json.loads(roles or "[]")
    decision = await asyncio.to_thread(
        _require_capability,
        peer,
        "stream.proxy",
        assertion={"sub": subject_hash, "roles": roles},
    )
    playback_session = request.headers.get("X-Crate-Playback-Session", "")
    if not playback_session:
        raise HTTPException(status_code=403, detail="playback_session_required")
    if str(preview["node_uid"]) != str(peer["node_uid"]):
        raise HTTPException(status_code=403, detail="Ticket belongs to another peer")

    track = await asyncio.to_thread(
        get_track_delivery_row_by_entity_uid, preview["remote_entity_uid"]
    )
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    resolution = await asyncio.to_thread(
        resolve_playback,
        track,
        preview.get("delivery_policy") or "balanced",
        enqueue=True,
    )
    if resolution is None:
        raise HTTPException(status_code=404, detail="Track not found")

    response = _stream_resolved_file(
        request,
        resolution.file_path,
        media_type=resolution.media_type or media_type_for_path(resolution.file_path),
        extra_headers=_playback_headers(resolution),
        require_auth=False,
    )
    if request.method == "HEAD":
        return response

    file_size = int(resolution.file_path.stat().st_size)
    reserved_bytes = requested_byte_count(file_size, request.headers.get("range"))
    ticket_constraints = preview.get("constraints_json") or {}
    if isinstance(ticket_constraints, str):
        ticket_constraints = _json.loads(ticket_constraints or "{}")
    max_ticket_bytes = ticket_constraints.get("max_bytes")
    if max_ticket_bytes is not None and reserved_bytes > int(max_ticket_bytes):
        raise HTTPException(status_code=429, detail="ticket_byte_limit")

    constraints = decision.constraints
    max_peer_slots = (
        constraints.max_concurrent_streams
        if constraints and constraints.max_concurrent_streams
        else DEFAULT_MAX_STREAMS_PER_PEER
    )
    max_daily_bytes = (
        constraints.daily_stream_bytes
        if constraints and constraints.daily_stream_bytes
        else DEFAULT_DAILY_BYTES_PER_PEER
    )
    redis_client = await asyncio.to_thread(_request_redis, request)
    allowed, reason, stream_id = await asyncio.to_thread(
        acquire_stream_slot,
        redis_client,
        str(peer["node_uid"]),
        subject_hash,
        max_peer_slots=max_peer_slots,
        max_subject_slots=max(
            max_peer_slots,
            DEFAULT_MAX_STREAMS_PER_SUBJECT,
        ),
        logical_stream_key=ticket_uid,
    )
    if not allowed or not stream_id:
        raise HTTPException(status_code=429, detail=reason or "stream_limit")
    allowed, reason = await asyncio.to_thread(
        reserve_stream_bytes,
        redis_client,
        str(peer["node_uid"]),
        reserved_bytes,
        subject_hash=subject_hash,
        max_peer_bytes=max_daily_bytes,
        max_subject_bytes=min(max_daily_bytes, DEFAULT_DAILY_BYTES_PER_SUBJECT),
    )
    if not allowed:
        await asyncio.to_thread(
            release_stream_slot,
            redis_client,
            str(peer["node_uid"]),
            subject_hash,
            stream_id,
        )
        raise HTTPException(status_code=429, detail=reason or "byte_quota")

    ticket = await asyncio.to_thread(
        validate_ticket,
        ticket_uid,
        expected_node_uid=str(peer["node_uid"]),
        expected_audience=str(peer["node_uid"]),
        expected_subject=subject_hash,
        playback_session=playback_session,
        requested_range=request.headers.get("range"),
        current_policy_revision=decision.policy_revision,
    )
    if not ticket:
        await asyncio.to_thread(
            reconcile_stream_bytes,
            redis_client,
            str(peer["node_uid"]),
            reserved_bytes=reserved_bytes,
            actual_bytes=0,
            subject_hash=subject_hash,
        )
        await asyncio.to_thread(
            release_stream_slot,
            redis_client,
            str(peer["node_uid"]),
            subject_hash,
            stream_id,
        )
        raise HTTPException(status_code=404, detail="Ticket not found or expired")

    await asyncio.to_thread(
        record_remote_playback_delivery,
        requested_policy=str(preview.get("delivery_policy") or "balanced"),
        effective_policy=resolution.effective_policy,
        cache_hit=resolution.cache_hit,
        transcoded=resolution.transcoded,
    )

    return FederationQuotaResponse(
        response,
        redis_client=redis_client,
        node_uid=str(peer["node_uid"]),
        subject_hash=subject_hash,
        stream_id=stream_id,
        ticket_uid=ticket_uid,
        reserved_bytes=reserved_bytes,
        reconcile=reconcile_stream_bytes,
        release=release_stream_slot,
    )
