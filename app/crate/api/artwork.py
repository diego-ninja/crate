import base64
import io
import logging

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse, Response

from crate.api._deps import (
    album_names_from_entity_uid,
    album_names_from_id,
    artist_name_from_entity_uid,
    artist_name_from_id,
    extensions,
    library_path,
    safe_path,
)
from crate.api.auth import _require_auth
from crate.api.artwork_delivery import deliver_original_artwork
from crate.api.openapi_responses import (
    AUTH_ERROR_RESPONSES,
    error_response,
    merge_responses,
)
from crate.api.permissions import require_permission
from crate.api.schemas.artwork import (
    ArtworkApplyRequest,
    ArtworkExtractRequest,
    ArtworkExtractResponse,
    ArtworkFetchRequest,
    ArtworkMissingResponse,
    ArtworkQueuedResponse,
    ArtistArtworkAssetAssignRequest,
    ArtistArtworkCandidateImportRequest,
    ArtistArtworkSlot,
    ArtistHeroComposeRequest,
    ArtworkScanRequest,
    ArtistHeroArtworkResponse,
    ArtistHeroCandidateAnalysisRequest,
    ArtistHeroRecipe,
    ArtistHeroReviewRequest,
    ArtistHeroMigrationRequest,
    ArtistHeroRollbackRequest,
)
from crate.api.schemas.common import TaskEnqueueResponse
from crate.audio import get_audio_files
from crate.artwork import extract_embedded_cover, save_cover
from crate.artist_hero_candidates import (
    analyze_candidate_image,
    discover_artist_hero_candidates,
    load_candidate_content,
)
from crate.artist_hero_contract import (
    artist_hero_profile_contract,
    artist_hero_profile_ready_compositions,
)
from crate.db.repositories.library import get_albums_missing_covers, get_library_artist
from crate.db.repositories.artist_artwork_assets import (
    get_artist_artwork_asset,
    list_artist_artwork_assets,
)
from crate.db.repositories.artist_hero_artwork import (
    artist_hero_manifest_id,
    get_artist_hero_artwork,
    update_artist_hero_review_status,
)
from crate.db.repositories.featured_artists import get_artist_featured_state
from crate.db.releases import get_release_by_virtual_album_id
from crate.db.repositories.tasks import create_task
from crate.storage_layout import resolve_artist_dir
from crate.streaming.paths import cache_root

log = logging.getLogger(__name__)

router = APIRouter(tags=["artwork"])

_ARTWORK_RESPONSES = merge_responses(
    AUTH_ERROR_RESPONSES,
    {
        400: error_response("The request could not be processed."),
        404: error_response("The requested artwork resource could not be found."),
        422: error_response("The request payload failed validation."),
    },
)


def _require_artwork_editor(request: Request) -> dict:
    return require_permission(request, "library.metadata.write")


@router.get(
    "/api/artwork/missing",
    response_model=ArtworkMissingResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="List albums missing artwork",
)
def api_artwork_missing(request: Request):
    """List albums missing cover art with details."""
    _require_auth(request)
    import re

    year_re = re.compile(r"^\d{4}\s*[-–]\s*")
    rows = get_albums_missing_covers()
    albums = []
    for r in rows:
        albums.append(
            {
                "name": r["name"],
                "display_name": year_re.sub("", r["name"]),
                "artist": r["artist"],
                "year": r.get("year", ""),
                "mbid": r.get("musicbrainz_albumid"),
                "path": r.get("path", ""),
            }
        )
    return {"missing_count": len(albums), "albums": albums}


@router.post(
    "/api/artwork/scan",
    response_model=TaskEnqueueResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Queue a full missing-artwork scan",
)
def api_artwork_scan(request: Request, body: ArtworkScanRequest | None = None):
    """Queue a full scan for missing covers with source search. Returns task_id for SSE streaming."""
    _require_artwork_editor(request)
    auto_apply = body.auto_apply if body else False
    task_id = create_task("scan_missing_covers", {"auto_apply": auto_apply})
    return {"task_id": task_id}


@router.post(
    "/api/artwork/apply",
    response_model=TaskEnqueueResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Queue artwork application for a specific album",
)
def api_artwork_apply(request: Request, body: ArtworkApplyRequest):
    """Apply a specific cover to an album."""
    _require_artwork_editor(request)
    task_id = create_task("apply_cover", body.model_dump(exclude_none=True))
    return {"task_id": task_id}


@router.post(
    "/api/artwork/fetch",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Queue a cover-art fetch by MBID",
)
def api_artwork_fetch(request: Request, data: ArtworkFetchRequest):
    """Queue a task to fetch cover art from CAA."""
    _require_artwork_editor(request)
    if not data.mbid:
        return JSONResponse({"error": "No MBID provided"}, status_code=400)
    task_id = create_task("fetch_cover", {"mbid": data.mbid, "path": data.path})
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/extract",
    response_model=ArtworkExtractResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Extract embedded artwork from an album",
)
def api_artwork_extract(request: Request, data: ArtworkExtractRequest):
    """Extract embedded cover — fast enough to run inline."""
    _require_artwork_editor(request)
    lib = library_path()
    album_dir = safe_path(lib, data.path)
    if not album_dir or not album_dir.is_dir():
        return JSONResponse({"error": "Album not found"}, status_code=404)

    exts = extensions()
    tracks = get_audio_files(album_dir, exts)
    if not tracks:
        return JSONResponse({"error": "No tracks found"}, status_code=404)

    image = extract_embedded_cover(tracks[0])
    if not image:
        return JSONResponse({"error": "No embedded cover found"}, status_code=404)

    save_cover(album_dir, image)
    return {"status": "saved", "path": str(album_dir / "cover.jpg")}


def api_artwork_fetch_artist(request: Request, name: str):
    """Queue a task to fetch covers for all albums by an artist."""
    _require_artwork_editor(request)
    task_id = create_task("fetch_artist_covers", {"artist": name})
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/artists/{artist_id}/fetch",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Queue artwork fetches for an artist",
)
def api_artwork_fetch_artist_by_id(request: Request, artist_id: int):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return api_artwork_fetch_artist(request, artist_name)


@router.post(
    "/api/artwork/artists/by-entity/{artist_entity_uid}/fetch",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Queue artwork fetches for an artist by entity UID",
)
def api_artwork_fetch_artist_by_entity_uid(request: Request, artist_entity_uid: str):
    artist_name = artist_name_from_entity_uid(artist_entity_uid)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return api_artwork_fetch_artist(request, artist_name)


@router.post(
    "/api/artwork/fetch-all",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Queue fetches for all missing artwork",
)
def api_artwork_fetch_all(request: Request):
    """Queue a task to fetch all missing covers."""
    _require_artwork_editor(request)
    task_id = create_task("fetch_artwork_all")
    return {"status": "queued", "task_id": task_id}


async def api_upload_cover(
    request: Request, artist: str, album: str, file: UploadFile = File(...)
):
    """Upload a cover image for an album. Saved to staging, worker copies to album dir."""
    _require_artwork_editor(request)
    import base64

    data = await file.read()
    task_id = create_task(
        "upload_image",
        {
            "type": "cover",
            "artist": artist,
            "album": album,
            "data_b64": base64.b64encode(data).decode(),
        },
    )
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/albums/{album_id}/upload-cover",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Upload album artwork",
)
async def api_upload_cover_by_id(
    request: Request, album_id: int, file: UploadFile = File(...)
):
    if album_id < 0:
        _require_artwork_editor(request)
        import base64

        release = get_release_by_virtual_album_id(album_id)
        if not release:
            return JSONResponse({"error": "Release not found"}, status_code=404)
        data = await file.read()
        task_id = create_task(
            "upload_image",
            {
                "type": "release_cover",
                "release_id": abs(album_id),
                "artist": release.get("artist_name", ""),
                "album": release.get("album_title", ""),
                "data_b64": base64.b64encode(data).decode(),
            },
        )
        return {"status": "queued", "task_id": task_id}

    album_names = album_names_from_id(album_id)
    if not album_names:
        return JSONResponse({"error": "Album not found"}, status_code=404)
    artist, album = album_names
    return await api_upload_cover(request, artist, album, file)


@router.post(
    "/api/artwork/albums/by-entity/{album_entity_uid}/upload-cover",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Upload album artwork by entity UID",
)
async def api_upload_cover_by_entity_uid(
    request: Request, album_entity_uid: str, file: UploadFile = File(...)
):
    album_names = album_names_from_entity_uid(album_entity_uid)
    if not album_names:
        return JSONResponse({"error": "Album not found"}, status_code=404)
    artist, album = album_names
    return await api_upload_cover(request, artist, album, file)


async def api_upload_artist_photo(
    request: Request, name: str, file: UploadFile = File(...)
):
    """Upload artist photo. Worker saves to artist dir."""
    _require_artwork_editor(request)
    import base64

    data = await file.read()
    task_id = create_task(
        "upload_image",
        {
            "type": "artist_photo",
            "artist": name,
            "data_b64": base64.b64encode(data).decode(),
        },
    )
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/artists/{artist_id}/upload-photo",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Upload an artist photo",
)
async def api_upload_artist_photo_by_id(
    request: Request, artist_id: int, file: UploadFile = File(...)
):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return await api_upload_artist_photo(request, artist_name, file)


@router.post(
    "/api/artwork/artists/by-entity/{artist_entity_uid}/upload-photo",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Upload an artist photo by entity UID",
)
async def api_upload_artist_photo_by_entity_uid(
    request: Request, artist_entity_uid: str, file: UploadFile = File(...)
):
    artist_name = artist_name_from_entity_uid(artist_entity_uid)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return await api_upload_artist_photo(request, artist_name, file)


async def api_upload_background(
    request: Request, name: str, file: UploadFile = File(...)
):
    """Upload artist background. Worker saves to artist dir."""
    _require_artwork_editor(request)
    import base64

    data = await file.read()
    task_id = create_task(
        "upload_image",
        {
            "type": "background",
            "artist": name,
            "data_b64": base64.b64encode(data).decode(),
        },
    )
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/artists/{artist_id}/upload-background",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Upload an artist background image",
)
async def api_upload_background_by_id(
    request: Request, artist_id: int, file: UploadFile = File(...)
):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return await api_upload_background(request, artist_name, file)


@router.post(
    "/api/artwork/artists/by-entity/{artist_entity_uid}/upload-background",
    response_model=ArtworkQueuedResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Upload an artist background image by entity UID",
)
async def api_upload_background_by_entity_uid(
    request: Request, artist_entity_uid: str, file: UploadFile = File(...)
):
    artist_name = artist_name_from_entity_uid(artist_entity_uid)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return await api_upload_background(request, artist_name, file)


async def api_upload_artist_hero(
    request: Request,
    name: str,
    file: UploadFile,
    desktop_recipe: str,
    mobile_recipe: str,
    composition: str = "shared",
):
    """Queue worker-owned rendering of both artist-hero compositions."""
    _require_artwork_editor(request)
    import base64

    desktop = ArtistHeroRecipe.model_validate_json(desktop_recipe)
    mobile = ArtistHeroRecipe.model_validate_json(mobile_recipe)
    if composition not in {"shared", "desktop", "mobile"}:
        return JSONResponse({"error": "Invalid composition"}, status_code=400)
    data = await file.read()
    if not data or len(data) > 25 * 1024 * 1024:
        return JSONResponse({"error": "Invalid image"}, status_code=400)
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as source:
            width, height = source.size
            if width <= 0 or height <= 0 or width * height > 80_000_000:
                raise ValueError("unsafe image dimensions")
            source.verify()
    except (Image.DecompressionBombError, OSError, ValueError):
        return JSONResponse({"error": "Invalid image"}, status_code=400)
    task_id = create_task(
        "upload_image",
        {
            "type": "artist_hero",
            "artist": name,
            "data_b64": base64.b64encode(data).decode(),
            "desktop_recipe": desktop.model_dump(),
            "mobile_recipe": mobile.model_dump(),
            "composition": composition,
        },
    )
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/artists/{artist_id}/upload-hero",
    response_model=ArtworkQueuedResponse,
    response_model_exclude_none=True,
    responses=_ARTWORK_RESPONSES,
    summary="Upload and compose editorial artist-hero artwork",
)
async def api_upload_artist_hero_by_id(
    request: Request,
    artist_id: int,
    file: UploadFile = File(...),
    desktop_recipe: str = Form(...),
    mobile_recipe: str = Form(...),
    composition: str = Form("shared"),
):
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return await api_upload_artist_hero(
        request, artist_name, file, desktop_recipe, mobile_recipe, composition
    )


@router.post(
    "/api/artwork/artists/by-entity/{artist_entity_uid}/upload-hero",
    response_model=ArtworkQueuedResponse,
    response_model_exclude_none=True,
    responses=_ARTWORK_RESPONSES,
    summary="Upload artist-hero artwork by entity UID",
)
async def api_upload_artist_hero_by_entity_uid(
    request: Request,
    artist_entity_uid: str,
    file: UploadFile = File(...),
    desktop_recipe: str = Form(...),
    mobile_recipe: str = Form(...),
    composition: str = Form("shared"),
):
    artist_name = artist_name_from_entity_uid(artist_entity_uid)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    return await api_upload_artist_hero(
        request, artist_name, file, desktop_recipe, mobile_recipe, composition
    )


@router.get(
    "/api/artwork/artists/{artist_id}/hero-profile",
    response_model=ArtistHeroArtworkResponse,
    responses=_ARTWORK_RESPONSES,
    summary="Read an artist-hero artwork profile",
)
def api_artist_hero_profile(request: Request, artist_id: int):
    _require_auth(request)
    if not artist_name_from_id(artist_id):
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    profile = get_artist_hero_artwork(artist_id)
    if not profile:
        return JSONResponse({"error": "Artist hero not found"}, status_code=404)
    featured_state = get_artist_featured_state(artist_id) or {}
    payload = {key: value for key, value in profile.items() if key != "render_manifest"}
    payload.update(
        {
            "is_featured": bool(featured_state.get("is_featured")),
            "featured_devices": list(artist_hero_profile_ready_compositions(profile)),
        }
    )
    payload.update(artist_hero_profile_contract(artist_id=artist_id, profile=profile))
    return JSONResponse(
        jsonable_encoder(payload), headers={"Cache-Control": "no-store"}
    )


@router.get(
    "/api/artwork/artists/{artist_id}/hero-source",
    responses=_ARTWORK_RESPONSES,
    summary="Read the editable source for an artist-hero composition",
)
def api_artist_hero_source(
    request: Request, artist_id: int, composition: str | None = None
):
    _require_auth(request)
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)

    root = library_path().resolve()
    artist_dir = resolve_artist_dir(
        root,
        get_library_artist(artist_name),
        fallback_name=artist_name,
        existing_only=True,
    )
    if not artist_dir:
        return JSONResponse({"error": "Artist hero source not found"}, status_code=404)

    if composition not in {None, "desktop", "mobile"}:
        return JSONResponse({"error": "Invalid composition"}, status_code=400)
    if composition:
        profile = get_artist_hero_artwork(int(artist_id))
        if profile and profile.get(f"{composition}_enabled", True) is False:
            return JSONResponse(
                {"error": "Artist hero composition not found"}, status_code=404
            )
    composition_path = (
        artist_dir / f"artist-hero-source-{composition}.jpg"
        if composition
        else artist_dir / "artist-hero-source.jpg"
    )
    source_path = composition_path.resolve()
    if composition and not source_path.is_file():
        source_path = (artist_dir / "artist-hero-source.jpg").resolve()
    if not source_path.is_relative_to(root) or not source_path.is_file():
        return JSONResponse({"error": "Artist hero source not found"}, status_code=404)
    return deliver_original_artwork(
        source_path,
        cache_control="private, max-age=300, stale-while-revalidate=3600",
    )


@router.post(
    "/api/artwork/artists/{artist_id}/preview-hero",
    response_model=ArtworkQueuedResponse,
    response_model_exclude_none=True,
    responses=_ARTWORK_RESPONSES,
    summary="Render an unsaved artist-hero preview with the canonical worker",
)
async def api_preview_artist_hero(
    request: Request,
    artist_id: int,
    recipe: str = Form(...),
    composition: str = Form(...),
    file: UploadFile | None = File(None),
):
    _require_artwork_editor(request)
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    if composition not in {"desktop", "mobile"}:
        return JSONResponse({"error": "Invalid composition"}, status_code=400)
    try:
        normalized_recipe = ArtistHeroRecipe.model_validate_json(recipe)
    except ValueError as exc:
        return JSONResponse({"error": f"Invalid hero recipe: {exc}"}, status_code=422)

    params: dict[str, object] = {
        "artist": artist_name,
        "artist_id": artist_id,
        "composition": composition,
        "recipe": normalized_recipe.model_dump(),
    }
    if file is not None:
        data = await file.read()
        if not data or len(data) > 25 * 1024 * 1024:
            return JSONResponse({"error": "Invalid image"}, status_code=400)
        try:
            from PIL import Image

            with Image.open(io.BytesIO(data)) as source:
                width, height = source.size
                if width <= 0 or height <= 0 or width * height > 80_000_000:
                    raise ValueError("unsafe image dimensions")
                source.verify()
        except (Image.DecompressionBombError, OSError, ValueError):
            return JSONResponse({"error": "Invalid image"}, status_code=400)
        params["data_b64"] = base64.b64encode(data).decode()

    task_id = create_task("preview_artist_hero", params)
    return {"status": "queued", "task_id": task_id}


@router.get(
    "/api/artwork/artists/{artist_id}/hero-preview/{preview_id}",
    responses=_ARTWORK_RESPONSES,
    summary="Read a temporary canonical artist-hero preview",
)
def api_artist_hero_preview(request: Request, artist_id: int, preview_id: str):
    _require_artwork_editor(request)
    if not artist_name_from_id(artist_id) or not preview_id.isalnum():
        return JSONResponse({"error": "Preview not found"}, status_code=404)
    preview_path = (
        cache_root() / "artist-hero-previews" / f"{preview_id}.webp"
    ).resolve()
    preview_root = (cache_root() / "artist-hero-previews").resolve()
    if not preview_path.is_relative_to(preview_root) or not preview_path.is_file():
        return JSONResponse({"error": "Preview not found"}, status_code=404)
    return FileResponse(
        preview_path,
        media_type="image/webp",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.get(
    "/api/artwork/artists/{artist_id}/hero-candidates",
    responses=_ARTWORK_RESPONSES,
    summary="Discover ranked source images for an artist hero",
)
def api_artist_hero_candidates(request: Request, artist_id: int):
    _require_artwork_editor(request)
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    root = library_path().resolve()
    artist_dir = resolve_artist_dir(
        root,
        get_library_artist(artist_name),
        fallback_name=artist_name,
        existing_only=True,
    )
    if not artist_dir:
        return JSONResponse({"error": "Artist directory not found"}, status_code=404)
    candidates = discover_artist_hero_candidates(
        artist_id=artist_id,
        artist_name=artist_name,
        artist_dir=artist_dir,
    )
    return {"candidates": [candidate.to_dict() for candidate in candidates]}


@router.get(
    "/api/artwork/artists/{artist_id}/assets",
    responses=_ARTWORK_RESPONSES,
    summary="List curated artwork assets for an artist",
)
def api_artist_artwork_assets(request: Request, artist_id: int):
    _require_artwork_editor(request)
    if not artist_name_from_id(artist_id):
        return JSONResponse({"error": "Artist not found"}, status_code=404)

    assets = []
    for stored_asset in list_artist_artwork_assets(artist_id):
        asset = {
            key: value for key, value in stored_asset.items() if key != "storage_path"
        }
        asset["preview_url"] = (
            f"/api/artwork/artists/{artist_id}/assets/{asset['id']}/preview"
        )
        assets.append(asset)
    return {"assets": assets}


@router.get(
    "/api/artwork/artists/{artist_id}/assets/{asset_id}/preview",
    responses=_ARTWORK_RESPONSES,
    summary="Preview a curated artist artwork asset",
)
def api_artist_artwork_asset_preview(request: Request, artist_id: int, asset_id: int):
    _require_artwork_editor(request)
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    asset = get_artist_artwork_asset(artist_id, asset_id)
    if not asset:
        return JSONResponse({"error": "Artwork asset not found"}, status_code=404)

    root = library_path().resolve()
    artist_dir = resolve_artist_dir(
        root,
        get_library_artist(artist_name),
        fallback_name=artist_name,
        existing_only=True,
    )
    if not artist_dir:
        return JSONResponse({"error": "Artist directory not found"}, status_code=404)
    source_path = (artist_dir / str(asset["storage_path"])).resolve()
    if (
        not source_path.is_relative_to(artist_dir.resolve())
        or not source_path.is_file()
    ):
        return JSONResponse({"error": "Artwork asset not found"}, status_code=404)
    return Response(
        source_path.read_bytes(),
        media_type=str(asset["mime_type"]),
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.delete(
    "/api/artwork/artists/{artist_id}/assets/{asset_id}",
    response_model=ArtworkQueuedResponse,
    response_model_exclude_none=True,
    responses=_ARTWORK_RESPONSES,
    summary="Delete an unassigned artist artwork asset",
)
def api_delete_artist_artwork_asset(request: Request, artist_id: int, asset_id: int):
    _require_artwork_editor(request)
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    if not get_artist_artwork_asset(artist_id, asset_id):
        return JSONResponse({"error": "Artwork asset not found"}, status_code=404)
    task_id = create_task(
        "delete_artist_artwork_asset",
        {"artist": artist_name, "artist_id": artist_id, "asset_id": asset_id},
    )
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/artists/{artist_id}/assets/upload",
    response_model=ArtworkQueuedResponse,
    response_model_exclude_none=True,
    responses=_ARTWORK_RESPONSES,
    summary="Upload an image into an artist artwork gallery",
)
async def api_upload_artist_artwork_asset(
    request: Request, artist_id: int, file: UploadFile = File(...)
):
    _require_artwork_editor(request)
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    data = await file.read()
    if not data or len(data) > 25 * 1024 * 1024:
        return JSONResponse({"error": "Invalid image"}, status_code=400)
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as source:
            width, height = source.size
            if width <= 0 or height <= 0 or width * height > 80_000_000:
                raise ValueError("unsafe image dimensions")
            source.verify()
    except (Image.DecompressionBombError, OSError, ValueError):
        return JSONResponse({"error": "Invalid image"}, status_code=400)

    task_id = create_task(
        "import_artist_artwork_asset",
        {
            "artist": artist_name,
            "artist_id": artist_id,
            "data_b64": base64.b64encode(data).decode(),
            "filename": file.filename or "artwork",
            "content_type": file.content_type,
            "origin": "manual-upload",
            "label": file.filename or "Uploaded artwork",
        },
    )
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/artists/{artist_id}/assets/import-candidate",
    response_model=ArtworkQueuedResponse,
    response_model_exclude_none=True,
    responses=_ARTWORK_RESPONSES,
    summary="Import a trusted candidate into an artist artwork gallery",
)
def api_import_artist_artwork_candidate(
    request: Request, artist_id: int, body: ArtistArtworkCandidateImportRequest
):
    _require_artwork_editor(request)
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    task_id = create_task(
        "import_artist_artwork_asset",
        {
            "artist": artist_name,
            "artist_id": artist_id,
            "candidate": body.candidate,
            "origin": "curated-candidate",
            "label": body.label or "Imported candidate",
        },
    )
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/artists/{artist_id}/slots/{slot}",
    response_model=ArtworkQueuedResponse,
    response_model_exclude_none=True,
    responses=_ARTWORK_RESPONSES,
    summary="Assign a curated image to an artist artwork slot",
)
def api_assign_artist_artwork_slot(
    request: Request,
    artist_id: int,
    slot: ArtistArtworkSlot,
    body: ArtistArtworkAssetAssignRequest,
):
    _require_artwork_editor(request)
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    task_id = create_task(
        "assign_artist_artwork_slot",
        {
            "artist": artist_name,
            "artist_id": artist_id,
            "slot": slot,
            "asset_id": body.asset_id,
        },
    )
    return {"status": "queued", "task_id": task_id}


@router.get(
    "/api/artwork/artists/{artist_id}/hero-candidates/preview",
    responses=_ARTWORK_RESPONSES,
    summary="Preview a trusted artist-hero candidate",
)
def api_artist_hero_candidate_preview(request: Request, artist_id: int, candidate: str):
    _require_artwork_editor(request)
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    root = library_path().resolve()
    artist_dir = resolve_artist_dir(
        root,
        get_library_artist(artist_name),
        fallback_name=artist_name,
        existing_only=True,
    )
    if not artist_dir:
        return JSONResponse({"error": "Artist directory not found"}, status_code=404)
    loaded = load_candidate_content(
        candidate, artist_id=artist_id, artist_dir=artist_dir
    )
    if loaded is None:
        return JSONResponse({"error": "Candidate not found"}, status_code=404)
    content, _origin = loaded
    return Response(
        content,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.post(
    "/api/artwork/artists/{artist_id}/hero-candidates/analyze",
    responses=_ARTWORK_RESPONSES,
    summary="Analyze one artist-hero candidate with the configured vision model",
)
def api_analyze_artist_hero_candidate(
    request: Request, artist_id: int, body: ArtistHeroCandidateAnalysisRequest
):
    _require_artwork_editor(request)
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    root = library_path().resolve()
    artist_dir = resolve_artist_dir(
        root,
        get_library_artist(artist_name),
        fallback_name=artist_name,
        existing_only=True,
    )
    if not artist_dir:
        return JSONResponse({"error": "Artist directory not found"}, status_code=404)
    loaded = load_candidate_content(
        body.candidate, artist_id=artist_id, artist_dir=artist_dir
    )
    if loaded is None:
        return JSONResponse({"error": "Candidate not found"}, status_code=404)
    analysis = analyze_candidate_image(loaded[0])
    if analysis is None:
        return JSONResponse(
            {"error": "The configured model cannot analyze images"}, status_code=409
        )
    return analysis.model_dump()


@router.post(
    "/api/artwork/artists/{artist_id}/compose-hero",
    response_model=ArtworkQueuedResponse,
    response_model_exclude_none=True,
    responses=_ARTWORK_RESPONSES,
    summary="Recompose artist-hero artwork from its persisted source",
)
def api_compose_artist_hero(
    request: Request, artist_id: int, body: ArtistHeroComposeRequest
):
    _require_artwork_editor(request)
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    task_id = create_task(
        "compose_artist_hero",
        {
            "artist": artist_name,
            "desktop_recipe": body.desktop_recipe.model_dump(),
            "mobile_recipe": body.mobile_recipe.model_dump(),
            "composition": body.composition,
        },
    )
    return {"status": "queued", "task_id": task_id}


@router.patch(
    "/api/artwork/artists/{artist_id}/hero-profile",
    responses=_ARTWORK_RESPONSES,
    summary="Review an artist-hero artwork profile",
)
def api_review_artist_hero(
    request: Request, artist_id: int, body: ArtistHeroReviewRequest
):
    _require_artwork_editor(request)
    if not artist_name_from_id(artist_id):
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    if not update_artist_hero_review_status(artist_id, body.review_status):
        return JSONResponse({"error": "Artist hero not found"}, status_code=404)
    from crate.api.cache_events import (
        broadcast_invalidation,
        wait_for_cache_invalidation,
    )
    from crate.db.home_warming import warm_recent_home_discovery_snapshots

    broadcast_invalidation("home", "library", f"artist:{artist_id}")
    wait_for_cache_invalidation()
    warm_recent_home_discovery_snapshots()
    return {"status": body.review_status}


@router.delete(
    "/api/artwork/artists/{artist_id}/hero-profile/{composition}",
    response_model=ArtworkQueuedResponse,
    response_model_exclude_none=True,
    responses=_ARTWORK_RESPONSES,
    summary="Queue deletion of one artist-hero composition",
)
def api_delete_artist_hero_composition(
    request: Request, artist_id: int, composition: str
):
    _require_artwork_editor(request)
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    if composition not in {"desktop", "mobile"}:
        return JSONResponse({"error": "Invalid composition"}, status_code=400)
    profile = get_artist_hero_artwork(artist_id)
    if not profile or profile.get(f"{composition}_enabled", True) is False:
        return JSONResponse(
            {"error": "Artist hero composition not found"}, status_code=404
        )
    params = {
        "artist": artist_name,
        "artist_id": artist_id,
        "composition": composition,
    }
    if profile.get("revision"):
        params["expected_revision"] = str(profile["revision"])
    task_id = create_task(
        "delete_artist_hero_composition",
        params,
    )
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/artists/{artist_id}/derive-hero",
    response_model=ArtworkQueuedResponse,
    response_model_exclude_none=True,
    responses=_ARTWORK_RESPONSES,
    summary="Derive artist-hero artwork from the current background",
)
def api_derive_artist_hero(request: Request, artist_id: int):
    _require_artwork_editor(request)
    artist_name = artist_name_from_id(artist_id)
    if not artist_name:
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    task_id = create_task("derive_artist_hero", {"artist": artist_name})
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/artist-heroes/backfill",
    response_model=ArtworkQueuedResponse,
    response_model_exclude_none=True,
    responses=_ARTWORK_RESPONSES,
    summary="Backfill eligible artist-hero artwork",
)
def api_backfill_artist_heroes(request: Request):
    _require_artwork_editor(request)
    task_id = create_task(
        "backfill_artist_heroes", {"after_artist_id": 0, "batch_size": 25}
    )
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/artist-heroes/migration-canary",
    response_model=ArtworkQueuedResponse,
    response_model_exclude_none=True,
    responses=_ARTWORK_RESPONSES,
    summary="Run a dry-run artist-hero publication migration canary",
)
def api_migrate_artist_heroes(
    request: Request, body: ArtistHeroMigrationRequest | None = None
):
    _require_artwork_editor(request)
    payload = body or ArtistHeroMigrationRequest()
    task_id = create_task(
        "migrate_artist_heroes",
        {
            "after_artist_id": payload.after_artist_id,
            "batch_size": payload.batch_size,
            "dry_run": payload.dry_run,
        },
    )
    return {"status": "queued", "task_id": task_id}


@router.post(
    "/api/artwork/artists/{artist_id}/hero-profile/rollback",
    response_model=ArtworkQueuedResponse,
    response_model_exclude_none=True,
    responses=_ARTWORK_RESPONSES,
    summary="Queue rollback to a retained artist-hero manifest",
)
def api_rollback_artist_hero(
    request: Request, artist_id: int, body: ArtistHeroRollbackRequest
):
    _require_artwork_editor(request)
    if not artist_name_from_id(artist_id):
        return JSONResponse({"error": "Artist not found"}, status_code=404)
    profile = get_artist_hero_artwork(artist_id)
    if not profile:
        return JSONResponse({"error": "Artist hero not found"}, status_code=404)
    active_manifest = profile.get("render_manifest")
    if not isinstance(active_manifest, dict):
        return JSONResponse(
            {"error": "Artist hero has no versioned manifest"}, status_code=409
        )
    task_id = create_task(
        "rollback_artist_hero",
        {
            "artist_id": artist_id,
            "expected_revision": str(profile.get("revision") or ""),
            "expected_active_manifest_id": artist_hero_manifest_id(active_manifest),
            "target_manifest_id": body.target_manifest_id,
        },
    )
    return {"status": "queued", "task_id": task_id}
