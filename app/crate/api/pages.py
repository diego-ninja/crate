from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from crate.api.auth import _require_auth

router = APIRouter()

_templates_dir = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(_templates_dir))


@router.get("/", response_class=HTMLResponse)
def index(request: Request):
    _require_auth(request)
    return templates.TemplateResponse("app.html", {"request": request, "page": "dashboard"})


@router.get("/browse", response_class=HTMLResponse)
def browse(request: Request):
    _require_auth(request)
    return templates.TemplateResponse("app.html", {"request": request, "page": "browse"})


@router.get("/artist/{name:path}", response_class=HTMLResponse)
def artist_page(request: Request, name: str):
    _require_auth(request)
    return templates.TemplateResponse("app.html", {"request": request, "page": "artist", "artist_name": name})


@router.get("/album/{artist:path}/{album:path}", response_class=HTMLResponse)
def album_page(request: Request, artist: str, album: str):
    _require_auth(request)
    return templates.TemplateResponse("app.html", {"request": request, "page": "album", "artist_name": artist, "album_name": album})


@router.get("/health", response_class=HTMLResponse)
def health_page(request: Request):
    _require_auth(request)
    return templates.TemplateResponse("app.html", {"request": request, "page": "health"})


@router.get("/duplicates", response_class=HTMLResponse)
def duplicates_page(request: Request):
    _require_auth(request)
    return templates.TemplateResponse("app.html", {"request": request, "page": "duplicates"})


@router.get("/artwork", response_class=HTMLResponse)
def artwork_page(request: Request):
    _require_auth(request)
    return templates.TemplateResponse("app.html", {"request": request, "page": "artwork"})


@router.get("/organizer", response_class=HTMLResponse)
def organizer_page(request: Request):
    _require_auth(request)
    return templates.TemplateResponse("app.html", {"request": request, "page": "organizer"})


@router.get("/imports", response_class=HTMLResponse)
def imports_page(request: Request):
    _require_auth(request)
    return templates.TemplateResponse("app.html", {"request": request, "page": "imports"})


@router.get("/analytics", response_class=HTMLResponse)
def analytics_page(request: Request):
    _require_auth(request)
    return templates.TemplateResponse("app.html", {"request": request, "page": "analytics"})


@router.get("/missing-albums", response_class=HTMLResponse)
def missing_albums_page(request: Request):
    _require_auth(request)
    return templates.TemplateResponse("app.html", {"request": request, "page": "missing-albums"})


@router.get("/quality", response_class=HTMLResponse)
def quality_page(request: Request):
    _require_auth(request)
    return templates.TemplateResponse("app.html", {"request": request, "page": "quality"})
