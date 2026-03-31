# Minimal Regression Strategy

## Goal

Catch product regressions earlier than:

- `npm run build`
- Python syntax checks
- "container starts cleanly"

This is intentionally a **minimum useful layer**, not a full QA system.

## Why

Recent refactors shipped clean builds and healthy containers while still regressing user-visible behavior in `listen`, for example:

- `Explore` losing genre/decade badges
- `Explore` search returning no visible results despite matching data
- route/module splits invalidating old tests without obvious failures

## Principles

- prioritize **critical user surfaces**, not broad low-signal coverage
- test **contracts and journeys**, not implementation details
- keep the first layer **fast enough to run often**
- separate:
  - mocked contract tests
  - live smoke against the real dev stack
  - future browser-level checks

## Layer 1: Backend Contract Tests

Use `pytest` + existing `TestClient` setup for endpoints that power high-risk `listen` views.

Initial contract set:

- `/api/browse/filters`
  - returns `genres`, `decades`, `countries`, `formats`
  - keeps shape stable for `listen Explore`
- `/api/search`
  - always returns `artists`, `albums`, `tracks`
  - shape includes fields actually consumed by `listen`

Current entry point:

- `app/tests/test_explore_contracts.py`

Command:

- `make regression-api`

## Layer 2: Live Smoke Against Dev Stack

Run a tiny authenticated smoke check against the running local backend.

This is important because contract tests with mocks do not catch:

- router registration/order mistakes
- auth/session flow regressions
- dev-only misconfiguration
- database/data-shape mismatches

Initial live smoke checks:

- login via `/api/auth/login`
- fetch `/api/browse/filters`
- fetch `/api/search?q=<known query>`
- assert non-empty result for a known library query

Current entry point:

- `scripts/regression_smoke.py`

Command:

- `make regression-smoke`

Configurable via env:

- `CRATE_SMOKE_BASE_URL`
- `CRATE_SMOKE_EMAIL`
- `CRATE_SMOKE_PASSWORD`
- `CRATE_SMOKE_SEARCH_QUERY`

## Layer 3: Future Browser Smoke For Listen

This is the next step when we want UI-level confidence for `listen`.

Recommended scope:

- `Explore` renders genre badges
- `Explore` renders decade badges
- typing in search shows artist/album/track results
- `Library` tabs switch correctly
- `Album` actions render and do not break playback state

Recommended tool:

- Playwright, only for a **small set of critical flows**

Not implemented yet in this batch.

## Minimum Rule Before Listen Changes

Before merging significant `listen` changes, run:

1. `make regression-api`
2. `make regression-smoke`
3. `cd app/listen && npm run build`

If a change touches playlist, auth, or playback infra, also run:

4. `cd app/ui && npm run build`
5. rebuild `api` and `worker` in dev if backend changed

## Notes

- old tests that patched `crate.api.browse` no longer cover the real split modules like `browse_artist` and `browse_media`
- new regression tests should patch the **real module owning the route**
- this strategy is intentionally small; the value is in catching obvious product regressions early, not maximizing coverage percentage
