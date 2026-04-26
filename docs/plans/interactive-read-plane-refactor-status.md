# Interactive Read Plane Refactor Status

Date: 2026-04-26
Branch: `refactor/interactive_read_models`

## Executive Summary

This refactor is well past the halfway point and the new architecture is already the dominant shape of the backend.

Current estimate:

- Structural refactor complete: `~97%`
- Remaining work: `~3%`

What that means in practice:

- The runtime no longer depends on the deprecated `crate.db` facade as a hot path.
- Most of the backend has already been converted into thin facades over more focused `queries/`, `repositories/`, `jobs/`, and `surface` modules.
- Snapshot-backed admin/listen surfaces, domain events, and dedicated SSE channels are already in place and actively used.
- Alembic is already the only live migration path for fresh installs and normal runtime bootstrap.
- The last few sessions removed eleven more concentrated backend modules from the “real monolith” list; what remains is now mostly the final query-heavy/service-heavy tail plus the last conceptual cutover of pipeline state to the new shadow/read-model plane.

## Hard Constraints Followed During This Refactor

- No new runtime code was added to the deprecated facade [app/crate/db/__init__.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/__init__.py).
- Runtime imports were progressively drained away from legacy `crate.db.*` shims and toward explicit `queries/`, `repositories/`, `jobs/`, and `surface` modules.
- Existing HTTP contracts, worker handlers, and UI payload shapes were preserved while moving internals underneath.
- Boundaries were reinforced with tests after each cut.

## What Has Already Been Rebuilt

### 1. Core architectural foundations

- `Alembic-only` bootstrap/runtime path is in place.
- Legacy migration bridge/runtime path was removed from the active startup path.
- Persistent UI snapshot store exists and is actively used.
- Domain events and snapshot notifications now exist as first-class backend mechanisms.
- Admin and Listen already read a large amount of state from snapshot-backed surfaces rather than live recomputation.

### 2. Major backend domains already migrated to thin facades

These domains have already been split into focused internals with thin facades or compat shims:

- `library`
- `auth`
- `playlists`
- `shows`
- `user_library`
- `genres`
- `tasks`
- `radio`
- `social`
- `management`
- `home`
- `analytics`
- `bliss`
- `paths`
- import queue read models
- admin surfaces
- ops snapshot builders
- UI snapshot store

### 3. Recent cuts completed in this session

These were specifically completed and validated in the latest run:

- `schema_sections/library` split into:
  - [app/crate/db/schema_sections/library_catalog.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/schema_sections/library_catalog.py)
  - [app/crate/db/schema_sections/library_genres.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/schema_sections/library_genres.py)
  - [app/crate/db/schema_sections/library_similarity.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/schema_sections/library_similarity.py)
  - facade: [app/crate/db/schema_sections/library.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/schema_sections/library.py)
- `analytics_overview` split into:
  - [app/crate/db/queries/analytics_overview_distributions.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/analytics_overview_distributions.py)
  - [app/crate/db/queries/analytics_overview_stats.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/analytics_overview_stats.py)
  - [app/crate/db/queries/analytics_overview_timeline.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/analytics_overview_timeline.py)
  - facade: [app/crate/db/queries/analytics_overview.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/analytics_overview.py)
- `home_tracks` split into:
  - [app/crate/db/queries/home_track_rows.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/home_track_rows.py)
  - [app/crate/db/queries/home_track_album_candidates.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/home_track_album_candidates.py)
  - [app/crate/db/queries/home_track_discovery.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/home_track_discovery.py)
  - [app/crate/db/queries/home_track_recent_interest.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/home_track_recent_interest.py)
  - [app/crate/db/queries/home_track_artist_core.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/home_track_artist_core.py)
  - facade: [app/crate/db/queries/home_tracks.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/home_tracks.py)
- `paths_graph_queries` split into:
  - [app/crate/db/queries/paths_artist_graph_queries.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/paths_artist_graph_queries.py)
  - [app/crate/db/queries/paths_bliss_candidate_queries.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/paths_bliss_candidate_queries.py)
  - facade: [app/crate/db/queries/paths_graph_queries.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/paths_graph_queries.py)
- `browse_media` split into:
  - [app/crate/db/queries/browse_media_search.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/browse_media_search.py)
  - [app/crate/db/queries/browse_media_favorites.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/browse_media_favorites.py)
  - [app/crate/db/queries/browse_media_track_lookup.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/browse_media_track_lookup.py)
  - [app/crate/db/queries/browse_media_track_genres.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/browse_media_track_genres.py)
  - [app/crate/db/queries/browse_media_mood.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/browse_media_mood.py)
  - facade: [app/crate/db/queries/browse_media.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/browse_media.py)
- `home_builder_shared` split into:
  - [app/crate/db/home_builder_dates.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/home_builder_dates.py)
  - [app/crate/db/home_builder_identity.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/home_builder_identity.py)
  - [app/crate/db/home_builder_text.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/home_builder_text.py)
  - [app/crate/db/home_builder_track_payloads.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/home_builder_track_payloads.py)
  - [app/crate/db/home_builder_track_selection.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/home_builder_track_selection.py)
  - facade: [app/crate/db/home_builder_shared.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/home_builder_shared.py)
- `home_builder_upcoming` split into:
  - [app/crate/db/home_builder_upcoming_artists.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/home_builder_upcoming_artists.py)
  - [app/crate/db/home_builder_upcoming_insights.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/home_builder_upcoming_insights.py)
  - [app/crate/db/home_builder_upcoming_feed.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/home_builder_upcoming_feed.py)
  - facade: [app/crate/db/home_builder_upcoming.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/home_builder_upcoming.py)
- `analytics_surfaces` split into:
  - [app/crate/db/analytics_surface_shared.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/analytics_surface_shared.py)
  - [app/crate/db/analytics_quality_surface.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/analytics_quality_surface.py)
  - [app/crate/db/analytics_missing_surface.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/analytics_missing_surface.py)
  - [app/crate/db/analytics_surface_invalidation.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/analytics_surface_invalidation.py)
  - facade: [app/crate/db/analytics_surfaces.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/analytics_surfaces.py)
- `tasks_mutations` split into:
  - [app/crate/db/repositories/tasks_mutation_shared.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/tasks_mutation_shared.py)
  - [app/crate/db/repositories/tasks_creation.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/tasks_creation.py)
  - [app/crate/db/repositories/tasks_updates.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/tasks_updates.py)
  - [app/crate/db/repositories/tasks_scan_results.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/tasks_scan_results.py)
  - facade: [app/crate/db/repositories/tasks_mutations.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/tasks_mutations.py)
- `analysis_backfill` split into:
  - [app/crate/db/jobs/analysis_backfill_processing_state.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jobs/analysis_backfill_processing_state.py)
  - [app/crate/db/jobs/analysis_backfill_shadow_tables.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jobs/analysis_backfill_shadow_tables.py)
  - runner: [app/crate/db/jobs/analysis_backfill_runner.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jobs/analysis_backfill_runner.py)
  - facade: [app/crate/db/jobs/analysis_backfill.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jobs/analysis_backfill.py)
- `library_entity_upserts` split into:
  - [app/crate/db/repositories/library_artist_upserts.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/library_artist_upserts.py)
  - [app/crate/db/repositories/library_album_upserts.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/library_album_upserts.py)
  - [app/crate/db/repositories/library_track_upserts.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/library_track_upserts.py)
  - facade: [app/crate/db/repositories/library_entity_upserts.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/library_entity_upserts.py)

- `browse_artist` split into:
  - [app/crate/db/queries/browse_artist_refs.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/browse_artist_refs.py)
  - [app/crate/db/queries/browse_artist_filters.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/browse_artist_filters.py)
  - [app/crate/db/queries/browse_artist_listing.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/browse_artist_listing.py)
  - [app/crate/db/queries/browse_artist_tracks.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/browse_artist_tracks.py)
  - [app/crate/db/queries/browse_artist_genres.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/browse_artist_genres.py)
  - facade: [app/crate/db/queries/browse_artist.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/browse_artist.py)
- `shows_upserts` split into:
  - [app/crate/db/repositories/shows_ticketmaster_upserts.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/shows_ticketmaster_upserts.py)
  - [app/crate/db/repositories/shows_lastfm_merge.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/shows_lastfm_merge.py)
  - facade: [app/crate/db/repositories/shows_upserts.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/shows_upserts.py)
- `genres_taxonomy_writes` split into:
  - [app/crate/db/repositories/genres_taxonomy_cleanup.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/genres_taxonomy_cleanup.py)
  - [app/crate/db/repositories/genres_taxonomy_nodes.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/genres_taxonomy_nodes.py)
  - [app/crate/db/repositories/genres_taxonomy_edges.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/genres_taxonomy_edges.py)
  - [app/crate/db/repositories/genres_taxonomy_metadata.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/genres_taxonomy_metadata.py)
  - shared helpers: [app/crate/db/repositories/genres_taxonomy_shared.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/genres_taxonomy_shared.py)
  - facade: [app/crate/db/repositories/genres_taxonomy_writes.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/genres_taxonomy_writes.py)
- `genres_taxonomy_graph` split into:
  - [app/crate/db/queries/genres_taxonomy_graph_edges.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/genres_taxonomy_graph_edges.py)
  - [app/crate/db/queries/genres_taxonomy_graph_hierarchy.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/genres_taxonomy_graph_hierarchy.py)
  - [app/crate/db/queries/genres_taxonomy_graph_nodes.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/genres_taxonomy_graph_nodes.py)
  - [app/crate/db/queries/genres_taxonomy_graph_query.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/genres_taxonomy_graph_query.py)
  - facade: [app/crate/db/queries/genres_taxonomy_graph.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/genres_taxonomy_graph.py)
- `playlists_rule_engine` split into:
  - [app/crate/db/repositories/playlists_rule_engine_config.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/playlists_rule_engine_config.py)
  - [app/crate/db/repositories/playlists_rule_engine_genre.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/playlists_rule_engine_genre.py)
  - [app/crate/db/repositories/playlists_rule_engine_builder.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/playlists_rule_engine_builder.py)
  - [app/crate/db/repositories/playlists_rule_engine_executor.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/playlists_rule_engine_executor.py)
  - facade: [app/crate/db/repositories/playlists_rule_engine.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/playlists_rule_engine.py)
- `analysis_shared` split into:
  - [app/crate/db/jobs/analysis_state_helpers.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jobs/analysis_state_helpers.py)
  - [app/crate/db/jobs/analysis_state_events.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jobs/analysis_state_events.py)
  - [app/crate/db/jobs/analysis_processing_sql.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jobs/analysis_processing_sql.py)
  - [app/crate/db/jobs/analysis_requeue_filters.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jobs/analysis_requeue_filters.py)
  - facade: [app/crate/db/jobs/analysis_shared.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jobs/analysis_shared.py)
- `paths_scoring` split into:
  - [app/crate/db/paths_similarity.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/paths_similarity.py)
  - [app/crate/db/paths_candidates.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/paths_candidates.py)
  - [app/crate/db/paths_path_builder.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/paths_path_builder.py)
  - facade: [app/crate/db/paths_scoring.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/paths_scoring.py)
- `library_catalog_reads` split into:
  - [app/crate/db/repositories/library_artist_reads.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/library_artist_reads.py)
  - [app/crate/db/repositories/library_album_reads.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/library_album_reads.py)
  - [app/crate/db/repositories/library_track_reads.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/library_track_reads.py)
  - [app/crate/db/repositories/library_release_reads.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/library_release_reads.py)
  - facade: [app/crate/db/repositories/library_catalog_reads.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/library_catalog_reads.py)
- `home_builder_discovery` split into:
  - [app/crate/db/home_builder_recent_activity.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/home_builder_recent_activity.py)
  - [app/crate/db/home_builder_discovery_queries.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/home_builder_discovery_queries.py)
  - [app/crate/db/home_builder_release_recommendations.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/home_builder_release_recommendations.py)
  - facade: [app/crate/db/home_builder_discovery.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/home_builder_discovery.py)
- `playlists_crud` split into:
  - [app/crate/db/repositories/playlists_create.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/playlists_create.py)
  - [app/crate/db/repositories/playlists_mutate.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/playlists_mutate.py)
  - [app/crate/db/repositories/playlists_duplicate.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/playlists_duplicate.py)
  - facade: [app/crate/db/repositories/playlists_crud.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/playlists_crud.py)

## Eventing Status: Domain Events and SSE

This section matters because a future continuation should preserve the event-driven direction rather than backsliding into polling or live recomposition.

### Domain event types currently in play

Confirmed emitters currently in tree:

- `ui.invalidate`
  - emitted from [app/crate/api/cache_events.py](/Users/diego/Code/Ninja/musicdock/app/crate/api/cache_events.py)
  - used as generic invalidation bridge
- `ui.snapshot.updated`
  - emitted from [app/crate/db/ui_snapshot_writes.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/ui_snapshot_writes.py)
  - this is the canonical persisted snapshot update event
- `track.analysis.updated`
  - emitted from [app/crate/db/jobs/analysis_state_events.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jobs/analysis_state_events.py)
- `track.bliss.updated`
  - emitted from [app/crate/db/jobs/analysis_state_events.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jobs/analysis_state_events.py)
- `user.history.changed`
  - emitted from [app/crate/db/repositories/user_library_playback_writes.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/user_library_playback_writes.py)
- `user.follows.changed`
  - emitted from [app/crate/db/repositories/user_library_preferences.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/user_library_preferences.py)
- `user.saved_albums.changed`
  - emitted from [app/crate/db/repositories/user_library_preferences.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/user_library_preferences.py)
- `user.likes.changed`
  - emitted from [app/crate/db/repositories/user_library_preferences.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/user_library_preferences.py)
- `playlist.changed`
  - emitted from [app/crate/db/repositories/playlists_shared.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/repositories/playlists_shared.py)
- `library.import_queue.changed`
  - emitted from [app/crate/db/import_queue_mutations.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/import_queue_mutations.py)

### Snapshot eventing

Snapshot notifications now have an explicit Redis-backed channel layer:

- helper: [app/crate/db/snapshot_events.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/snapshot_events.py)
- global channel namespace: `crate:sse:snapshot`
- per-snapshot channel pattern:
  - `crate:sse:snapshot:{scope}:{subject_key}`

Confirmed direct snapshot-channel subscribers:

- `ops/dashboard`
  - [app/crate/api/admin_ops.py](/Users/diego/Code/Ninja/musicdock/app/crate/api/admin_ops.py)
- `home:discovery:{user_id}`
  - [app/crate/api/me.py](/Users/diego/Code/Ninja/musicdock/app/crate/api/me.py)
- `stack/global`
  - [app/crate/api/stack.py](/Users/diego/Code/Ninja/musicdock/app/crate/api/stack.py)

### SSE endpoints currently present

Core / legacy-ish:

- `/api/events`
- `/api/events/task/{id}`
- `/api/cache/events`

Snapshot-backed admin surfaces:

- `/api/admin/ops-stream`
- `/api/admin/tasks-stream`
- `/api/admin/logs-stream`
- `/api/admin/stack-stream`
- `/api/admin/health-stream`

Listen / user-facing:

- `/api/me/home/discovery-stream`
- `/api/admin/system-playlists/{playlist_id}/stream`

Acquisition surfaces:

- `/api/acquisition/stream`
- `/api/acquisition/search/soulseek/{search_id}/stream`
- `/api/acquisition/new-releases/stream`

Track streaming endpoints also exist, but they are media transport, not snapshot/state channels:

- `/api/tracks/{track_id}/stream`
- `/api/tracks/by-storage/{storage_id}/stream`
- Subsonic stream endpoints

### Important eventing gaps still remaining

These are worth continuing:

- `ops` and `home` are the most mature event-driven surfaces.
- Some other surfaces still rely on their own SSE signal but are not yet driven by a richer domain event model.
- `ui.invalidate` still exists as a broad fallback bus. It should continue shrinking in importance as more surfaces react to specific events and/or snapshot updates.
- The projector still has room to grow semantically. It is no longer trivial, but it is not yet the full domain projection layer described in the original plan.

### Eventing / SSE delta in this session

- New `domain_events`: none
- New snapshot channels: none
- New SSE endpoints: none
- Semantics changes:
  - none; this session did not change invalidation-vs-snapshot semantics

## Current Runtime / Boundary Rules That Are Already Enforced

There is now a significant amount of boundary coverage in [app/tests/test_runtime_boundaries.py](/Users/diego/Code/Ninja/musicdock/app/tests/test_runtime_boundaries.py). These tests currently enforce:

- runtime must not import the deprecated `crate.db` facade directly
- runtime must not import legacy domain shims outside their compat layers
- facades such as `library_reads`, `auth`, `playlists_generation`, `playlists_reads`, `playlists_rule_engine`, `genres_taxonomy_writes`, `browse_artist`, `analysis_shared`, `paths_scoring`, `home_builder_discovery`, etc. must remain thin
- several query modules are required to remain read-only and avoid `transaction_scope`

If a future session starts failing these tests, it probably means the refactor regressed architecturally rather than functionally.

## Recent Validation Runs

These were executed successfully during the latest session:

- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_db.py -q -k "library_schema_section or init_db_ or runtime_boundaries"`
  Result: `84 passed, 61 deselected`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_api.py app/tests/test_ops_snapshot.py app/tests/test_openapi_contract.py -q -k "analytics or stats or timeline or runtime_boundaries"`
  Result: `87 passed, 82 deselected`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_api.py app/tests/test_openapi_contract.py -q -k "home or runtime_boundaries"`
  Result: `84 passed, 80 deselected`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_radio_contracts.py app/tests/test_api.py -q -k "paths or radio or runtime_boundaries"`
  Result: `86 passed, 56 deselected`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_api.py app/tests/test_explore_contracts.py app/tests/test_openapi_contract.py -q -k "browse_media or search_from_db or test_search_contract_shapes_artist_album_and_track_results or runtime_boundaries"`
  Result: `83 passed, 86 deselected`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_api.py app/tests/test_openapi_contract.py -q -k "home or runtime_boundaries"`
  Result: `78 passed, 80 deselected`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_api_integration.py app/tests/test_openapi_contract.py -q -k "home_discovery or upcoming or runtime_boundaries"`
  Result: `79 passed, 48 deselected`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_db.py -q -k "analytics_surfaces or runtime_boundaries"`
  Result: `76 passed, 62 deselected`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_db.py app/tests/test_task_dedup.py -q -k "create_task or update_task or dedup or save_and_get_latest or runtime_boundaries"`
  Result: `93 passed, 55 deselected`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_analysis_daemon.py -q -k "backfill_pipeline_read_models or runtime_boundaries"`
  Result: `78 passed, 8 deselected`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_db.py -q -k "upsert_artist or upsert_album or upsert_track or runtime_boundaries"`
  Result: `82 passed, 59 deselected`
- `uv run pytest app/tests/test_api.py app/tests/test_explore_contracts.py app/tests/test_runtime_boundaries.py -q -k "TestArtistsAPI or TestArtistDetailAPI or TestExploreFiltersContract or browse_artist or runtime_boundaries"`
  Result: `70 passed`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_api.py app/tests/test_api_integration.py app/tests/test_openapi_contract.py -q -k "cached_shows or upcoming or browse_shows_upcoming_and_media_routes or runtime_boundaries"`
  Result: `68 passed`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_db.py app/tests/test_api.py app/tests/test_openapi_contract.py -q -k "genres or runtime_boundaries or taxonomy"`
  Result: `71 passed`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_playlist_genre_relevance.py app/tests/test_api.py app/tests/test_openapi_contract.py -q -k "playlist or runtime_boundaries or genres"`
  Result: `80 passed`
- `uv run pytest app/tests/test_analysis_daemon.py app/tests/test_runtime_boundaries.py app/tests/test_track_popularity.py -q -k "analysis or runtime_boundaries or popularity"`
  Result: `80 passed`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_radio_contracts.py app/tests/test_api.py -q -k "paths or radio or runtime_boundaries"`
  Result: `75 passed`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_api.py app/tests/test_auth.py app/tests/test_openapi_contract.py -q -k "library or artists or albums or runtime_boundaries"`
  Result: `76 passed`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_api.py app/tests/test_api_integration.py app/tests/test_projector.py app/tests/test_openapi_contract.py -q -k "home or projector or runtime_boundaries"`
  Result: `81 passed`
- `uv run pytest app/tests/test_runtime_boundaries.py app/tests/test_api.py app/tests/test_openapi_contract.py app/tests/test_playlist_genre_relevance.py -q -k "playlist or runtime_boundaries"`
  Result: `82 passed`

## Remaining High-Value Work

This is the most important part of the handoff.

### Top remaining modules by size / concentration

At the time of writing, the main remaining concentrated modules are roughly:

- [app/crate/db/jam.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jam.py)
- [app/crate/db/similarities.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/similarities.py)
- [app/crate/db/paths_service.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/paths_service.py)
- [app/crate/db/jobs/repair.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jobs/repair.py)
- [app/crate/db/queries/shows.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/shows.py)
- [app/crate/db/queries/analytics_audio_insights.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/analytics_audio_insights.py)
- [app/crate/db/queries/analytics_catalog_insights.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/analytics_catalog_insights.py)
- [app/crate/db/schema_sections/curation.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/schema_sections/curation.py)
- [app/crate/db/queries/subsonic.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/subsonic.py)

### Recommended continuation order

The next session should probably continue in roughly this order:

1. [app/crate/db/queries/shows.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/shows.py)
2. [app/crate/db/paths_service.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/paths_service.py)
3. [app/crate/db/similarities.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/similarities.py)
4. [app/crate/db/jobs/repair.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jobs/repair.py)
5. [app/crate/db/jam.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jam.py)
6. [app/crate/db/queries/analytics_audio_insights.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/analytics_audio_insights.py)
7. [app/crate/db/queries/analytics_catalog_insights.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/analytics_catalog_insights.py)
8. [app/crate/db/schema_sections/curation.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/schema_sections/curation.py)
9. [app/crate/db/queries/subsonic.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/subsonic.py)

Reason for this order:

- finish the last three modules from the original recommended block first
- then tackle the remaining concentrated query/schema nodes that still hold a lot of inline SQL and shaping logic
- keep the pipeline truth cutover moving by continuing to favor split modules around `track_processing_state` and shadow tables instead of re-expanding legacy `library_tracks` hot columns

## Remaining Conceptual Work Beyond File Splits

Even after the remaining large files are split, these deeper items still need a final pass:

### 1. Final pipeline truth cutover

This is still one of the most important unfinished conceptual tasks.

Current state:

- `track_processing_state` exists and is already used heavily
- analysis/bliss writes already use new helper layers and batch paths
- read-plane tables/shadows already exist

Still to finish:

- make `track_processing_state` and the shadow result tables the unquestioned operational truth
- reduce compatibility dependence on legacy `library_tracks.analysis_state` / `library_tracks.bliss_state`
- keep `library_tracks` stable and non-churny as much as possible

### 2. Final snapshot / projector maturity pass

Still worth doing:

- expand projector behavior where still too generic
- reduce reliance on broad invalidation when a semantic event would do
- keep moving surfaces toward snapshot-driven updates

### 3. Final cleanup / consolidation pass

Before calling the refactor “done”, the last pass should include:

- boundary tests for any newly split facades
- a broad regression pytest sweep
- `app/ui` and `app/listen` build validation
- one final review of runtime imports so no new accidental backslides appeared

## Files That Matter Most For The Next Session

Start here first:

- [app/crate/db/queries/shows.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/shows.py)
- [app/crate/db/paths_service.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/paths_service.py)
- [app/crate/db/similarities.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/similarities.py)
- [app/crate/db/jobs/repair.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jobs/repair.py)
- [app/crate/db/jam.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/jam.py)

Secondary:

- [app/crate/db/queries/analytics_audio_insights.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/analytics_audio_insights.py)
- [app/crate/db/queries/analytics_catalog_insights.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/analytics_catalog_insights.py)
- [app/crate/db/schema_sections/curation.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/schema_sections/curation.py)
- [app/crate/db/queries/subsonic.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/subsonic.py)

## Worktree / Commit State

- Branch: `refactor/interactive_read_models`
- The worktree is currently very dirty with many uncommitted refactor changes after the checkpoint commit.
- The last known checkpoint commit created during this long-running refactor before the current in-flight continuation was:
  - `f5c9ad2c` — `refactor: split home, paths, and media query modules`

Before stopping for a long time, it would be sensible in a future session to create another checkpoint commit once the next few remaining large cuts are done and a broader test sweep is green.

## Practical Resume Checklist

When resuming in a fresh session:

1. Read this file first.
2. Confirm branch: `git branch --show-current`
3. Start with:
   - [app/crate/db/queries/shows.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/queries/shows.py)
4. After each cut:
   - add/update a boundary test in [app/tests/test_runtime_boundaries.py](/Users/diego/Code/Ninja/musicdock/app/tests/test_runtime_boundaries.py)
   - run the smallest relevant pytest slice
   - only then continue to the next block
5. Once the remaining big nodes are split:
   - do a broad regression sweep
   - run `npm run build` in [app/ui](/Users/diego/Code/Ninja/musicdock/app/ui) and [app/listen](/Users/diego/Code/Ninja/musicdock/app/listen)
   - re-estimate progress and decide whether the final pipeline truth cutover still needs separate focused work

## Bottom Line

This is no longer an “architecture idea”. It is already the dominant reality of the backend.

What remains is not a messy unknown; it is a finite tail:

- a handful of still-large modules
- the last conceptual cutover of pipeline truth
- and a final consolidation/validation pass

The next session should be able to continue directly from this file without having to reconstruct the whole refactor story from scratch.
