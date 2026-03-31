# Crate Listen Refactor And Bug Roadmap

**Date**: 2026-03-30
**Status**: Active
**Scope**: `app/listen` frontend refinement, targeted backend support, handoff tracking

## Goal

Refine `crate-listen` as a separate consumer-facing product with a tighter mobile/PWA experience, while keeping it compatible with future Capacitor packaging for app stores.

This plan assumes:

- `app/listen` remains separate from `app/ui`
- `app/listen` is user-facing and listening-first
- `app/ui` remains desktop-oriented admin/management
- shared code is allowed only where it reduces duplication without coupling the two apps' UX

## Current State Summary

`app/listen` is materially smaller than `app/ui`, but complexity is concentrated in a few hotspots:

- `app/listen/src/contexts/PlayerContext.tsx`
- `app/listen/src/components/player/ExtendedPlayer.tsx`
- `app/listen/src/components/layout/TopBar.tsx`
- `app/listen/src/components/layout/Shell.tsx`
- `app/listen/src/pages/Explore.tsx`
- `app/listen/src/pages/Library.tsx`
- `app/listen/src/pages/Artist.tsx`

Observed characteristics:

- build passes with `npm run build`
- auth exists but route protection in `listen` is still light
- a number of user-facing actions are still placeholders or TODOs
- `listen` now has a reusable modal shell for full-screen mobile / centered desktop overlays
- playlist description already exists in backend
- playlist sync to Navidrome already exists in backend
- follows / saved albums / likes / play history already exist in backend
- artist radio and similar tracks already exist in backend
- PWA surface is still minimal: manifest exists, but icons/offline lifecycle are not fleshed out

## User Findings Backlog

### Deferred For Later

- Google signin/signup
- Apple signin/signup

Google backend support already exists in `app/crate/api/auth.py`, but it is not being tackled in this phase. Apple support is not implemented yet.

### Identity / User Sync

- User sync (`listen -> backend -> navidrome`)

Notes:

- backend design and first implementation batch are now in place
- current personal-library data lives in Crate DB (`follows`, `saved albums`, `likes`, `history`)
- Navidrome link status now exists as explicit user state, separate from Crate auth identity
- playback identity should be treated separately from library identity:
  - `library track id` for likes/history/collection state
  - `navidrome id` for Navidrome-backed playback when available
  - fallback local path/engine when Navidrome is unavailable

### Playlists

- playlists can have cover and description
- playlist sync (`listen -> backend -> navidrome`)

Notes:

- `description` already exists in backend DB/API
- Navidrome sync endpoint/task already exists
- implemented in current batch:
  - playlists now support `cover_data_url` in backend DB/API
  - `listen` has a global playlist-creation modal as the main entry point
  - modal supports uploaded cover, description, seeded tracks, and track search
  - if no custom cover is uploaded, playlist UI falls back to a collage derived from album covers
  - `Add new playlist` is now available from album-level and track-level add-to-playlist affordances
  - existing playlists can now be edited and deleted from the playlist view
  - playlist view can now trigger `sync to Navidrome`
  - playlist sync now requires a linked Navidrome user and runs under that linked username instead of the global service context
- still pending:
  - decision on whether custom cover storage should remain DB-backed or move to media storage later

### New Section

- upload music (individual files or zipped albums)

Notes:

- this is a real full-stack feature, not a UI-only enhancement
- likely needs upload API, task creation, worker handling, progress state, and post-upload scan/sync

### Global Header

- top navigation previous/next pages

### Upcoming

- bring `Upcoming` from admin into `listen` as a first-class surface
- show only upcoming shows and releases for followed artists
- use the expandable show row with map as the primary show presentation
- surface upcoming shows inside the artist page as well
- allow the user to mark a show as attended / going
- include probable setlist in show surfaces where it adds value

Next layer after the current batch:

- reminders for attended shows
- “show prep” listening nudges before the event
  - one month before
  - one week before
- probable setlist playback entry points tied to those reminders

### Expanded Player

- cover shadow
- volume must remain above extended player
- lyrics with extracted palette
- current synced line in the middle of the viewport
- gapless
- crossfade
- buffering
- new visualizers
- global keyboard shortcuts

Notes:

- cover shadow / z-index / synced-line centering are near-term UI/polish tasks
- gapless / crossfade / buffering are playback-engine tasks
- new visualizers are medium-size frontend tasks
- keyboard shortcuts should be designed to avoid conflicting with inputs/search
- visualizer controls should stay inside the player / visualizer surface, not in global settings

### Artist View

- too much blur in background image
- bio between listeners and genres
- buttons:
  - Play (Top Tracks)
  - Shuffle
- action buttons:
  - Follow / Following
  - Artist radio
  - Share >
- Top Tracks
- Albums
- Related artists

Notes:

- implemented in current refactor batch:
  - reduced hero blur/background intensity
  - moved bio into hero body between stats and genres
  - wired `Play`, `Shuffle`, and `Artist radio`
  - kept `Follow / Following` and added `Share`
  - added `Top Tracks` section powered by Navidrome-first endpoint with fallback behavior from backend
  - renamed similar-artists section to `Related Artists`

### Album Card

- overlays:
  - Play (main centered): start playing album
  - Heart (secondary top right): add to collection

Notes:

- implemented in current batch where `album_id` is available to the card
- cards without `album_id` can still show play, but collection toggling depends on album identity being present in the backing API response

### Album View

- action buttons:
  - Heart (add to collection)
  - Share
  - Contextual menu (popup menu)
    - Header (album thumb + title + artist)
    - Play now
    - Play next
    - Add to playlist >
    - Remove from my collection
    - Go to artist
    - Share >
- track list row actions:
  - Heart (add to collection)
  - Play next
  - Add to queue
  - Add to playlist >

Notes:

- album-level save/share/menu actions are now implemented
- per-track `add to playlist` is now implemented
- `Add new playlist` from album and track add-to-playlist flows is now implemented

### Library View

- sidebar links must navigate to correct tab
- liked songs appear as Unknown

## Technical Findings

### Already Backed By Existing Backend

- playlist description
- playlist sync to Navidrome
- follows / unfollows
- saved albums
- liked tracks
- play history
- artist radio
- similar tracks
- track info

### Likely Backend Work Required

- playlist cover
- user sync with Navidrome
- Apple signin/signup
- possibly add-to-playlist affordances optimized for `listen`

Upload first batch delivered:

- `listen` now has a dedicated upload page
- `admin` acquisition now surfaces upload too
- uploaded files land in the global library, not a user-private silo
- the uploading user automatically gets:
  - uploaded tracks liked
  - uploaded albums saved
  - uploaded artists followed
- after ingest, the same enrichment / analysis / bliss / popularity / similarity pipeline runs as for other ingestion sources

Upload follow-up still pending:

- richer progress / post-import feedback in `listen`
- better handling for complex multi-album loose-file uploads
- drag-and-drop polish and mobile UX refinement
- regression coverage around upload ingest

### Current Frontend Risks

- `TrackRow` / player interactions are now centralized, but row variants are starting to grow and may deserve a small component split
- `gapless / crossfade` still need a second implementation pass if we want true dual-deck seamlessness; current player now preserves the safe single-audio architecture and makes better use of preloading
- upload now exists as a first dedicated batch, but still needs a second pass for robustness and richer UX
- `Upcoming` is now becoming its own product surface in `listen` and may deserve its own component/domain split if reminders, attendance, setlist previews, and post-ticket flows keep growing
- playlist covers are now moving away from DB-embedded data URLs toward stored assets served by the API; frontend contract remains compatible, but a second pass should remove the remaining legacy `cover_data_url` persistence path entirely

### Current Backend Risk Behind One Reported Bug

`Liked songs appear as Unknown` likely has a backend component:

- `app/crate/db/user_library.py` joins liked tracks on `library_tracks.path = user_liked_tracks.track_path`
- if `track_path` is stored in a different format from library paths, the join fails and title/artist/album come back null

This issue should be treated as a likely full-stack bug, not a frontend-only copy problem.

Root cause confirmed during implementation:

- `listen` album/track views send relative paths such as `Artist/Album/Track.flac`
- `library_tracks.path` is stored canonically as an absolute path inside the backend environment
- new likes could therefore be inserted with a relative path and later fail to resolve against `library_tracks`
- even after canonicalization, the frontend still needed a relative key so album hearts could match backend-returned liked rows

Follow-up architectural decision:

- path-based likes are too fragile for a library app that mixes relative paths, absolute library paths, and Navidrome ids
- likes should be stored by `library_tracks.id`
- playback should not reuse that same identifier, because `listen` needs Navidrome playback with local-engine fallback

## Recommended Delivery Order

### Batch 1: Quick Wins And Real User Bugs

- fix `Library` sidebar links to land on the correct tab
- investigate and fix `Liked songs appear as Unknown`
- complete missing `Artist` actions (`Play`, `Shuffle`, `Artist radio`)
- refine `Artist` layout (blur, bio placement, action row)

### Batch 2: Album And Collection UX

- album card overlays
- album save-to-collection
- album share
- album contextual menu
- track row add-to-playlist entrypoint

### Batch 3: Playlists

- playlist composer modal with cover, description and track seeding
- playlist artwork fallback collage in library/home/playlist views
- wire playlist sync to Navidrome from `listen`
- follow-up edit/manage flow for existing playlists

### Batch 4: Expanded Player Polish

- volume layering
- cover shadow
- lyrics centering
- palette-linked lyrics/visual treatment
- remove debug leftovers

### Batch 5: Playback Engine Enhancements

- buffering state/UX
- global keyboard shortcuts
- gapless
- crossfade
- new visualizers

### Batch 6: Larger Full-Stack Features

- upload music
- user sync to Navidrome
- social sign-in when re-prioritized

## Progress Tracking

### Completed

- initial deep reanalysis of `app/listen`
- verified `app/listen` build passes
- mapped feature requests into frontend-only vs full-stack vs deferred work
- fixed `Library` tab deep-linking:
  - `app/listen/src/components/layout/Shell.tsx` now links each collection item to a tab-specific `/library?tab=...`
  - `app/listen/src/pages/Library.tsx` now derives active tab from URL search params
  - verified with `cd app/listen && npm run build`
- fixed `Liked songs appear as Unknown` across frontend/backend paths:
  - `app/listen/src/components/cards/TrackRow.tsx` now prefers canonical library path over `navidrome_id` when both are available
  - `app/listen/src/pages/Library.tsx` now feeds liked-track playback with canonical `track_path`
  - `app/crate/db/user_library.py` now normalizes track identifiers to canonical library paths for likes and play history when possible
  - `app/crate/db/user_library.py` now resolves liked-track joins by either `path` or `navidrome_id`, helping previously stored non-canonical rows render metadata instead of `Unknown`
  - verified with `cd app/listen && npm run build`
  - rebuilt local dev API container so the backend fix is active
- unified like state in `listen` so hearts and liked list stay in sync:
  - added `app/listen/src/contexts/LikedTracksContext.tsx`
  - wrapped `app/listen/src/App.tsx` with `LikedTracksProvider`
  - `TrackRow`, `PlayerBar`, `FullscreenPlayer`, and `Library` now read/write shared liked-track state instead of isolated local booleans
  - verified with `cd app/listen && npm run build`
- hardened liked-track canonicalization for relative-vs-absolute library paths:
  - `app/crate/db/user_library.py` now resolves incoming identifiers by exact path, Navidrome id, computed library-root absolute path, `/music/...` path, or suffix match for relative frontend paths
  - `app/crate/db/user_library.py` now returns `relative_path` for liked rows so `listen` can compare and play liked tracks using the same identifier style as album/list views
  - `app/listen/src/contexts/LikedTracksContext.tsx` now indexes likes by absolute path, relative path, and Navidrome id
  - `app/listen/src/pages/Library.tsx` now uses `relative_path || resolved_path || track_path` when building playable liked-track entries
  - verified with `cd app/listen && npm run build`
- stabilized the audio/visualizer slice after playback regressions:
  - `app/listen/src/contexts/PlayerContext.tsx` now keeps the main player audio element as a shared singleton, which restored the live mini-player bars and the visualizer signal chain
  - `app/listen/src/hooks/use-audio-visualizer.ts` and `app/listen/src/components/player/visualizer/useMusicVisualizer.ts` are back on the stable single-player audio graph
  - committed as checkpoint `fc97ff7`
- refactored the visualizer to support multiple scenes:
  - `app/listen/src/components/player/visualizer/MusicVisualizer.ts` now supports scene modes instead of only the original spheres scene
  - added `app/listen/src/components/player/visualizer/geometry/Ring.ts`
  - `app/listen/src/components/player/visualizer/rendering/OpenGLRenderer.ts` now supports arbitrary model matrices for scene rendering
  - `app/listen/src/components/player/ExtendedPlayer.tsx` now exposes mode switching in visualizer settings
  - `app/listen/src/lib/player-visualizer-prefs.ts` now persists the selected visualizer mode
  - current modes: `spheres`, `halo`, `tunnel`
  - committed as checkpoint `660f20c`
  - rebuilt local dev API container so the backend fix is active
- refactored likes to use stable library ids instead of paths:
  - `app/crate/db/core.py` now defines `user_liked_tracks` as `user_id + track_id`
  - `app/crate/db/user_library.py` now resolves incoming track references to `library_tracks.id` and returns liked-track metadata directly from `library_tracks`
  - `app/crate/api/me.py` now accepts `track_id` as the primary like/unlike identifier, with `track_path` only as a transitional resolver input
  - `app/crate/api/browse_media.py` search results now include `track.id`, `path`, `duration`, and `navidrome_id`
  - `app/crate/db/playlists.py` now enriches playlist tracks with resolved `track_id` and `navidrome_id`
  - `app/listen/src/contexts/PlayerContext.tsx` now separates playback identity from `libraryTrackId`, preparing `listen` for Navidrome-first playback with local fallback
  - `app/listen/src/components/cards/TrackRow.tsx`, `app/listen/src/contexts/LikedTracksContext.tsx`, `app/listen/src/pages/Album.tsx`, `app/listen/src/pages/Explore.tsx`, `app/listen/src/pages/Playlist.tsx`, `app/listen/src/pages/Library.tsx`, `app/listen/src/components/player/PlayerBar.tsx`, and `app/listen/src/components/player/FullscreenPlayer.tsx` now use `track_id` for collection state
  - verified with `cd app/listen && npm run build`
  - rebuilt local dev API container so the schema/runtime change is active
- refined `Artist` page:
  - `app/listen/src/pages/Artist.tsx` now supports real `Play`, `Shuffle`, `Artist Radio`, `Follow`, and `Share` actions
  - bio now appears in the hero between listener stats and genres
  - hero background blur/opacity reduced
  - top-tracks section added using `/api/navidrome/artist/{name}/top-tracks`
  - similar-artists section reframed as `Related Artists`
  - verified with `cd app/listen && npm run build`
- added explicit Navidrome user-sync state and gating:
  - `app/listen/src/contexts/UserSyncContext.tsx` now fetches `/api/me/sync` and exposes mutation-safe status flags
  - `app/listen/src/App.tsx` now wraps `listen` with `UserSyncProvider`
  - `app/crate/api/playlists.py` now requires the playlist owner to have a synced Navidrome identity before queueing sync
  - `app/crate/worker_handlers/integrations.py` now creates Navidrome playlists as the linked external username instead of the shared service identity
  - `listen` should treat this as invisible infrastructure; user-facing UI must not mention Navidrome directly
  - verified with `cd app/listen && npm run build`
  - rebuilt local dev API/worker containers so the user-scoped sync is active
- added album collection/play affordances:
  - new `SavedAlbumsContext` in `app/listen/src/contexts/SavedAlbumsContext.tsx`
  - `app/listen/src/App.tsx` now wraps `listen` with `SavedAlbumsProvider`
  - `app/crate/api/browse_artist.py`, `app/crate/api/browse_album.py`, and `app/crate/api/browse_media.py` now expose album ids where needed by `listen`
  - `app/listen/src/components/cards/AlbumCard.tsx` now supports centered play overlay that starts album playback and a heart overlay for collection state when `album_id` is available
  - `app/listen/src/pages/Album.tsx` now supports album save/remove, share, contextual menu, play next for the whole album, and add-album-to-playlist
  - `app/listen/src/pages/Artist.tsx`, `app/listen/src/pages/Explore.tsx`, and `app/listen/src/pages/Library.tsx` now pass album ids into album cards where available
  - verified with `cd app/listen && npm run build`
  - rebuilt local dev API container so album ids are active in backend responses
- extracted reusable overlay primitives for `listen`:
  - added `app/listen/src/components/ui/AppPopover.tsx` for shared popover/menu surfaces
  - added `app/listen/src/hooks/use-dismissible-layer.ts` for shared outside-click + Escape dismissal behavior
  - applied the shared primitives to `TopBar`, `PlayerBar`, `Album`, and `ExtendedPlayer`
  - visual treatment and dismissal behavior are now more consistent across the main custom dropdown/popover surfaces
  - verified with `cd app/listen && npm run build`
- redesigned `Home` into a real listening surface and started consuming system playlists:
  - `app/listen/src/pages/Home.tsx` now prioritizes continuity (`Continue Listening`), global system playlists (`From Crate`), and personal/library surfaces instead of utility quick-links
  - added `app/listen/src/pages/CuratedPlaylist.tsx` as a dedicated read-only system-playlist page with play, shuffle, follow/unfollow, and track listing
  - `app/listen/src/App.tsx` now routes `listen` to `/curation/playlist/:id`
  - `app/listen/src/pages/Library.tsx` now shows followed system playlists alongside personal playlists
  - `app/crate/api/curation.py` now exposes active system playlists to `listen`, not only `is_curated = true`, so admin-created smart playlists can surface in the app
  - verified with `cd app/listen && npm run build`
  - rebuilt local dev API container so the new curation behavior is active
- expanded `Explore` into a stronger editorial/discovery surface:
  - `app/listen/src/pages/Explore.tsx` now shows `From Crate` playlists directly, including smart system playlists
  - added playlist category browsing inside `Explore`
  - added dedicated category detail view for system playlists via `/api/curation/playlists/category/{category}`
  - `Explore` now connects genres/decades browsing with playlist-led discovery instead of acting only as a filter/search page
  - verified with `cd app/listen && npm run build`
- added a first real `Settings` surface for `listen`:
  - `app/listen/src/pages/Settings.tsx` now exposes persisted playback and visualizer preferences
  - `app/listen/src/App.tsx` routes `/settings`
  - `app/listen/src/components/layout/TopBar.tsx` now opens the real settings page instead of a placeholder
  - verified with `cd app/listen && npm run build`
- improved player-level playlist actions:
  - `app/listen/src/components/player/PlayerBar.tsx` now supports adding the current track to an existing playlist from the player menu
  - the same menu can now seed a new playlist from the current track
  - the player menu now navigates to artist/album instead of showing placeholder actions
  - verified with `cd app/listen && npm run build`

### In Progress

- Batch 6
  - user sync to Navidrome
  - keep the linkage/admin workflow out of `listen` UI; the playback/sync backend should stay transparent to end users

### Pending Investigation

- root cause of `Liked songs appear as Unknown`
- playlist cover data model and storage path
- best API shape for upload music
- safe approach for gapless/crossfade with current audio architecture
- listening intelligence / stats foundation:
  - current `play_history` is too thin for a serious stats, Wrapped, or personalization surface
  - future work should move toward richer per-user playback events with played seconds, completion/skip state, and playback source context
  - see `docs/plans/2026-03-31-listen-user-stats-and-wrapped-design.md`
- system playlists created in `admin` are not yet surfaced in `listen` discovery/library:
  - most visible surfaces are now wired (`Home`, `Explore`, `Library`, playlist detail)
  - still worth checking that discovery keeps a good editorial hierarchy as more system playlists appear
  - follow/unfollow of system playlists must work locally in Crate even when Navidrome is offline; any later Navidrome sync should be treated as optional async projection, not as a prerequisite for the follow state itself
- `Home` / main music view needs a full product rethink:
  - current quick-links + recent/new/playlists layout is too weak to act as the listening home
  - re-evaluate against TIDAL / Spotify patterns:
    - continue listening
    - mixes for you / daily discovery / history mixes
    - editorial + system curated playlists
    - library pulse (new releases, recently played, new from followed artists)
  - once direction is chosen, redesign `app/listen/src/pages/Home.tsx` around 1-2 primary rails and stronger personalized/system surfaces
- playlist rows in `listen` still need action buttons / context actions:
  - current rows in `Library > Playlists` are mostly navigational and too passive
  - personal playlists should expose at least:
    - play
    - shuffle
    - edit
    - delete
    - share
  - system playlists should expose at least:
    - play
    - shuffle
    - follow / unfollow
    - share
    - maybe `add to library` wording instead of only row click-through
  - likely implementation shape:
    - row-level primary play affordance
    - compact secondary action cluster on hover / desktop
    - shared menu for lower-priority actions on mobile
- settings surface should keep growing as player features stabilize:
  - playback preferences now have a first home
  - future iterations should likely add infinite playback, suggestion cadence, and other player intelligence controls there
- future business reanalysis vs Spotify / TIDAL should include:
  - stats / Wrapped / Replay surfaces
  - what Crate can uniquely do with self-hosted full-history listening data
  - where personalized utility beats pure catalog parity
- reusable overlay primitives for `listen`:
  - extract consistent `Dropdown` / `Popover` / `Menu` components
  - unify `Escape`, click-outside, z-index, animation, and focus behavior
  - apply first to `TopBar`, `PlayerBar`, `Album`, playlist actions, and future settings surfaces

## Validation Checklist

For each batch, verify as applicable:

- `cd app/listen && npm run build`
- relevant navigation flows in desktop and mobile shell
- player still works after route changes
- no regressions in queue / like / follow / save actions
- if backend touched: API starts cleanly in dev stack and relevant endpoints respond

## Handoff Notes

If another agent picks this up next:

- preserve the product boundary between `app/listen` and `app/ui`
- prefer extracting small reusable `listen`-local components before introducing new shared abstractions
- prioritize reusable overlay primitives once the next visible UX batch is closed; repeated ad-hoc popovers are already creating enough debt to justify a dedicated pass
- treat `PlayerContext` changes carefully; many UI surfaces depend on it
- when fixing likes/collection issues, inspect both frontend IDs and backend `track_path` persistence
- if modifying docs beyond this file and the change affects app boundaries, also update `README.md` and `AGENTS.md`
