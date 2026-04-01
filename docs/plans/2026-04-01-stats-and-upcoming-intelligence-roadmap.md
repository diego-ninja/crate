# Crate Stats And Upcoming Intelligence Roadmap

**Date**: 2026-04-01
**Status**: Active
**Scope**: `listen` identity surfaces, listening telemetry, reminders, show-prep, and Wrapped foundations

## Goal

Build the next major product layer for `listen` around two linked ideas:

- rich per-user listening telemetry that can power stats, replay, mixes, and Wrapped
- a stronger `Upcoming` surface that uses those signals for reminders and pre-show listening value

This roadmap assumes:

- playback remains anchored in Crate-owned library identity (`track_id`)
- Navidrome can remain a playback backend, but not the source of truth for stats product logic
- `Upcoming` stays user-facing inside `listen`, not an admin-only surface
- backend support should ship in thin, mergeable batches before the UI becomes ambitious

## Why These Two Iterations Belong Together

`Stats / Wrapped` and `Upcoming` solve different product problems, but they reinforce each other:

- stats create durable identity and retention
- upcoming creates ambient utility around real-world music events
- listening telemetry lets Crate decide when a show reminder is relevant
- attending a show becomes a strong context for likely-setlist playback and recap surfaces

Together, they push `listen` past direct library playback into a product that feels alive between explicit play actions.

## Source Documents

This roadmap consolidates and sequences the work proposed in:

- [2026-03-31-listen-user-stats-and-wrapped-design.md](/Users/diego/Code/Ninja/musicdock/worktrees/stats-upcoming-intelligence/docs/plans/2026-03-31-listen-user-stats-and-wrapped-design.md)
- [2026-03-31-listen-product-gap-analysis.md](/Users/diego/Code/Ninja/musicdock/worktrees/stats-upcoming-intelligence/docs/plans/2026-03-31-listen-product-gap-analysis.md)
- [2026-03-30-listen-refactor-and-bug-roadmap.md](/Users/diego/Code/Ninja/musicdock/worktrees/stats-upcoming-intelligence/docs/plans/2026-03-30-listen-refactor-and-bug-roadmap.md)

## Product Outcomes

By the end of this roadmap, Crate should be able to support:

- a trustworthy `Stats` surface inside `listen`
- monthly / yearly / all-time summaries and replay objects
- future `Wrapped` narratives without rebuilding the data layer
- reminders for upcoming attended shows
- show-prep prompts tied to probable setlists and real listening behavior
- richer Home surfaces such as:
  - listening trends
  - replay mixes
  - upcoming reminders
  - pre-show listening prompts

## Guiding Principles

### 1. Track identity first

All serious listening telemetry should use `track_id` as the primary identity. `track_path` can stay as compatibility/debug metadata, but should not be the foundation of stats.

### 2. Count clearly and explainably

If Crate says a user has listened to something, the counting rule should be easy to explain:

- started
- qualified
- completed
- skipped

Wrapped and stats become untrustworthy very quickly if the counting criteria are fuzzy.

### 3. Build data infrastructure before visual storytelling

The first milestone is not a flashy Wrapped UI. The first milestone is a durable event model and stable aggregates.

### 4. Upcoming should use listening context, not just date proximity

A show reminder is more valuable if it knows:

- the user is actually attending
- the user has listened heavily to that artist recently
- a probable setlist exists
- the show is close enough to warrant prep or reminder UX

## Batches

## Batch 1 - Rich Play Event Tracking

**Current status**: first implementation batch delivered

### Goal

Replace the current thin play history model with an event model that can support real stats.

### Backend

- add `user_play_events` table
- keep `play_history` temporarily for backward compatibility
- add helper functions in user library / stats DB layer
- add `POST /api/me/play-events`
- define consistent event payload fields:
  - `track_id`
  - `track_path`
  - `started_at`
  - `ended_at`
  - `played_seconds`
  - `track_duration_seconds`
  - `completion_ratio`
  - `was_skipped`
  - `was_completed`
  - `play_source_type`
  - `play_source_id`
  - `play_source_name`
  - `device_type`
  - `app_platform`

### Listen

- instrument `PlayerContext` for:
  - start
  - stop
  - skip
  - completion
- move from “report only on track end” to “flush an explicit play event”
- ensure events survive normal pause/resume behavior without double counting

### Acceptance

- track completion and skip produce distinct events
- event rows use `track_id`
- recently played still works
- no visible regression in player behavior

## Batch 2 - Daily And Windowed Aggregates

**Current status**: first implementation batch delivered

### Goal

Create fast derived data for overview and trends.

### Backend

- add `user_daily_listening`
- add aggregate tables or materializations for:
  - `user_track_stats`
  - `user_artist_stats`
  - `user_album_stats`
  - `user_genre_stats`
- define update strategy:
  - synchronous lightweight update for daily counters where safe
  - background task/materialization refresh for heavier windows

Current implementation notes:

- aggregate tables now exist in the schema
- aggregates are recomputed per user when a new play event is recorded
- `GET /api/me/stats` already benefits from aggregate data for all-time totals/top artists
- this is intentionally synchronous for the first batch and may move to a task/materialization strategy later

### Windows

- `7d`
- `30d`
- `90d`
- `365d`
- `all_time`
- `monthly:<yyyy-mm>`

### Acceptance

- top artists/tracks/albums can be queried quickly by window
- daily minutes / play counts are queryable without scanning raw events

## Batch 3 - Stats API MVP

**Current status**: first implementation batch delivered

### Goal

Expose useful, stable stats endpoints before building visual surfaces.

### Backend endpoints

- `GET /api/me/stats/overview`
- `GET /api/me/stats/trends`
- `GET /api/me/stats/top-tracks`
- `GET /api/me/stats/top-artists`
- `GET /api/me/stats/top-albums`
- `GET /api/me/stats/top-genres`
- `GET /api/me/stats/recent-wins` or similar lightweight summary endpoint

Current implementation notes:

- the MVP API now ships:
  - `GET /api/me/stats/overview`
  - `GET /api/me/stats/trends`
  - `GET /api/me/stats/top-tracks`
  - `GET /api/me/stats/top-artists`
  - `GET /api/me/stats/top-albums`
  - `GET /api/me/stats/top-genres`
- supported windows currently are:
  - `7d`
  - `30d`
  - `90d`
  - `365d`
  - `all_time`
- `recent-wins` is still deferred

### Output expectations

- overview:
  - minutes listened
  - play count
  - complete plays
  - skip rate
  - streak / active days if available
- trends:
  - daily listening curve
  - weekly or monthly comparatives
- entity endpoints:
  - stable sorted lists
  - counts and minutes
  - optional movement vs previous period later

### Acceptance

- endpoints are fast enough for an in-app dashboard
- contracts are testable without the UI

## Batch 4 - Stats UI MVP In Listen

**Current status**: first implementation batch delivered

### Goal

Ship a first useful stats surface before Wrapped.

### Listen

- add `Stats` page
- include:
  - overview cards
  - top artists
  - top tracks
  - top albums
  - trend chart
  - time-window selector
- keep the first version functional, not overly narrative

Current implementation notes:

- `listen` now has a first `Stats` page wired to the MVP stats API
- the first version includes:
  - overview cards
  - daily trend chart
  - top tracks
  - top artists
  - top albums
  - top genres
  - time-window switching
- replay objects and narrative recap surfaces are still deferred to later batches

### Notes

- this is the “stats.fm / volt.fm utility” layer
- Wrapped storytelling comes later

### Acceptance

- a user can understand their last 30 days and all-time profile
- the page feels credible and not obviously placeholder

## Batch 5 - Replay Objects And Listening Recaps

### Goal

Turn stats into playable objects.

### Backend

- derive replay mixes from stats/history:
  - monthly replay
  - yearly replay
  - all-time replay
- define replay generation rules:
  - qualified plays only
  - duplicate caps
  - recent freshness rules where needed

### Listen

- add replay surfaces to `Home` and/or `Stats`
- add simple recap modules such as:
  - “Your month so far”
  - “Your top artists this month”
  - “Replay March 2026”

### Acceptance

- stats are not just a dashboard; they produce listening objects

## Batch 6 - Upcoming Intelligence Foundation

### Goal

Turn `Upcoming` from a useful page into an active assistant around attended shows.

### Backend

- extend attendance model if needed with reminder state
- add reminder metadata:
  - `one_month_sent_at`
  - `one_week_sent_at`
  - `day_before_sent_at`
- define a background task that scans future attended shows and emits reminder candidates

### Candidate API

- `GET /api/me/upcoming/reminders`
- or fold reminders into `GET /api/me/upcoming`

### Reminder types

- `show_reminder`
- `setlist_ready`
- `pre_show_prep`

### Acceptance

- the system can know which attended shows deserve a reminder
- reminder state is persisted and not re-sent repeatedly

## Batch 7 - Show Prep And Setlist Prompts

### Goal

Use listening context to make `Upcoming` feel uniquely Crate.

### Surfaces

- in `Upcoming`
- in `Home`
- optional lightweight in `Artist`

### UX examples

- “Roadburn is in 30 days. Want to warm up with the probable setlist?”
- “You’re going to see Kneecap next week. Play the likely setlist.”
- “You’ve barely listened to this artist lately. Start a prep session?”

### Logic inputs

- attendance state
- event proximity
- probable setlist availability
- recent listening intensity from `user_play_events`

### Acceptance

- pre-show prompts feel relevant, not spammy
- setlist playback is directly actionable

## Batch 8 - Wrapped / Year In Review

### Goal

Build the narrative layer on top of proven aggregates.

### Output

- yearly summary
- top tracks / artists / albums / genres
- total minutes
- listening personality-style insights only if grounded in real data
- optional shareable cards later

### Important rule

Wrapped should be a productized story over validated stats, not a separate counting system.

### Acceptance

- the numbers shown in Wrapped match the stats foundation
- the product feels special without becoming gimmicky

## Dependency Order

The critical path is:

1. Batch 1
2. Batch 2
3. Batch 3
4. Batch 4

Then the roadmap can branch:

- `Replay / Wrapped` path:
  - Batch 5
  - Batch 8
- `Upcoming intelligence` path:
  - Batch 6
  - Batch 7

This means we should not block all of `Upcoming` on Wrapped, but both should share the same telemetry foundation.

## Risks

### Player instrumentation complexity

`PlayerContext` is already a hotspot. Play-event instrumentation should be added carefully and may justify extracting a small reporting/controller layer early.

### Double counting

Seek, pause, replay, and skip behavior can easily inflate stats if the event model is naïve.

### Data volume

Raw `user_play_events` will grow much faster than `play_history`. Retention, indexing, and aggregation strategy matter from the start.

### False precision

It is better to ship fewer, trustworthy metrics than many opaque ones.

### Reminder fatigue

`Upcoming` reminders should be sparse and valuable. This is not a notification treadmill.

## Recommended First Implementation Batch

Start with Batch 1 only.

Concrete first cut:

- schema for `user_play_events`
- backend endpoint `POST /api/me/play-events`
- `listen` instrumentation in `PlayerContext`
- keep existing `play_history` posting temporarily if needed for compatibility
- basic tests for:
  - completed play
  - skipped play
  - duplicate protection around fast track changes

This gives us the highest-leverage foundation with the lowest product ambiguity.

## Out Of Scope For This Iteration

- social features
- public profile stats
- clips / stories / feed mechanics
- AI-generated listening personalities without explicit rules
- giant notification systems outside show-related reminders
