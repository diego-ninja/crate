#!/usr/bin/env python3
"""Minimal authenticated smoke checks against a running dev stack.

Purpose:
- catch API regressions that builds and boot logs do not catch
- validate critical Listen surfaces with real auth/session flow
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar


BASE_URL = os.environ.get("CRATE_SMOKE_BASE_URL", "http://localhost:8585")
EMAIL = os.environ.get("CRATE_SMOKE_EMAIL", "admin@cratemusic.app")
PASSWORD = os.environ.get("CRATE_SMOKE_PASSWORD", "admin")
SEARCH_QUERY = os.environ.get("CRATE_SMOKE_SEARCH_QUERY", "Birds")


def _json_request(
    opener: urllib.request.OpenerDirector,
    path: str,
    *,
    method: str = "GET",
    body: dict | None = None,
) -> dict:
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{BASE_URL}{path}", data=data, headers=headers, method=method)
    with opener.open(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _assert(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


def main() -> int:
    jar = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    try:
        login = _json_request(
            opener,
            "/api/auth/login",
            method="POST",
            body={"email": EMAIL, "password": PASSWORD},
        )
        _assert("email" in login, "login did not return user payload")

        filters = _json_request(opener, "/api/browse/filters")
        _assert(isinstance(filters.get("genres"), list), "filters.genres must be a list")
        _assert(isinstance(filters.get("decades"), list), "filters.decades must be a list")

        query = urllib.parse.quote(SEARCH_QUERY)
        search = _json_request(opener, f"/api/search?q={query}&limit=10")
        _assert(isinstance(search.get("artists"), list), "search.artists must be a list")
        _assert(isinstance(search.get("albums"), list), "search.albums must be a list")
        _assert(isinstance(search.get("tracks"), list), "search.tracks must be a list")
        _assert(
            len(search["artists"]) + len(search["albums"]) + len(search["tracks"]) > 0,
            f"search returned no results for query={SEARCH_QUERY!r}",
        )

        print("OK login")
        print(f"OK filters genres={len(filters['genres'])} decades={len(filters['decades'])}")
        print(
            "OK search "
            f"artists={len(search['artists'])} albums={len(search['albums'])} tracks={len(search['tracks'])}"
        )
        return 0
    except (urllib.error.URLError, urllib.error.HTTPError, AssertionError, json.JSONDecodeError) as exc:
        print(f"SMOKE FAILED: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
