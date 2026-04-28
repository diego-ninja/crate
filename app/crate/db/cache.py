"""Compatibility facade for cache helpers."""

from __future__ import annotations

from crate.db.cache_dir_mtimes import delete_dir_mtime, get_all_dir_mtimes, get_dir_mtime, set_dir_mtime
from crate.db.cache_musicbrainz import get_mb_cache, set_mb_cache
from crate.db.cache_runtime import (
    _get_redis,
    _MEM_MAX_SIZE,
    _MEM_TTL,
    _mem_cache,
    _mem_delete,
    _mem_get,
    _mem_set,
)
from crate.db.cache_settings import get_setting, set_setting
from crate.db.cache_store import (
    clear_all_cache_tables,
    delete_cache,
    delete_cache_prefix,
    get_cache,
    get_cache_stats,
    set_cache,
)


__all__ = [
    "_get_redis",
    "_MEM_MAX_SIZE",
    "_MEM_TTL",
    "_mem_cache",
    "_mem_delete",
    "_mem_get",
    "_mem_set",
    "clear_all_cache_tables",
    "delete_cache",
    "delete_cache_prefix",
    "delete_dir_mtime",
    "get_all_dir_mtimes",
    "get_cache",
    "get_cache_stats",
    "get_dir_mtime",
    "get_mb_cache",
    "get_setting",
    "set_cache",
    "set_dir_mtime",
    "set_mb_cache",
    "set_setting",
]
