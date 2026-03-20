import logging
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class AuthUser(BaseModel):
    user: Optional[str] = None
    groups: list[str] = []


class AutheliaMiddleware(BaseHTTPMiddleware):
    """Reads Remote-User/Remote-Groups headers set by Authelia and stores them in request.state."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        user = request.headers.get("Remote-User")
        groups_raw = request.headers.get("Remote-Groups", "")
        groups = [g.strip() for g in groups_raw.split(",") if g.strip()]

        request.state.auth_user = user
        request.state.auth_groups = groups

        if user:
            logger.debug("Authenticated request: user=%s groups=%s path=%s", user, groups, request.url.path)

        return await call_next(request)


@router.get("/me")
async def auth_me(request: Request) -> AuthUser:
    return AuthUser(
        user=getattr(request.state, "auth_user", None),
        groups=getattr(request.state, "auth_groups", []),
    )
