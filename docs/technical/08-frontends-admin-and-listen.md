# Frontend Architecture: Admin and Listen

## Two products, one backend

Crate has two frontend applications and they are intentionally not the same app
with two skins.

### Admin

- source: `app/ui/src`
- purpose: library management, operations, repair, acquisition, analytics,
  settings
- orientation: desktop-first

### Listen

- source: `app/listen/src`
- purpose: playback, browsing, discovery, social, offline/mobile/PWA use
- orientation: consumer-first, mobile-aware, Capacitor-ready

This split remains one of the most important product decisions in Crate.

## Shared frontend core

Shared code now has two layers:

- `app/shared/web` for thin API/route/util helpers
- `app/shared/ui` (`@crate/ui`) for the shared design system package

The shared layer is intentionally bounded. Most app state and product logic
remains app-specific.

## Admin app architecture

The admin app is still a fairly traditional operator SPA:

- auth context
- lightweight preview player
- notifications and tooling affordances
- snapshot-backed ops/dashboard contexts
- route-driven page composition

One notable current addition is the admin dashboard's visibility into runtime
eventing:

- domain-event stream diagnostics
- cache invalidation runtime
- SSE surface catalog

That data is exposed through the ops snapshot surface rather than being wired as
one-off dashboard fetches.

## Listen app architecture

The Listen app changed substantially during the refactor and is now more
explicitly composed.

### Composition root

`app/listen/src/App.tsx` is now intentionally tiny:

- `AppErrorBoundary`
- `AuthProvider`
- `AppRouter`

The bulk of routing and provider composition lives in `app-shell/`:

- `AppProviders.tsx`
- `AppRouter.tsx`
- `RouteGuards.tsx`
- `route-table.tsx`

### Routing

`route-table.tsx` defines public and protected route definitions and keeps lazy
imports centralized. `AppRouter` stitches them together under:

- `ServerGate` for native multi-server setup
- `ProtectedRoute` for auth gating
- `Shell` for the authenticated app chrome

### Providers

`AppProviders.tsx` composes the app-specific runtime providers:

- player
- follows
- likes
- offline
- saved albums
- playlist composer

## State management approach

Neither app uses Redux-style global state. The current strategy is:

- React contexts
- route-local `useApi(...)`
- focused hooks
- small shared utilities/mappers

The important architectural change is that several large contexts were split
internally while keeping their public hook contracts stable.

## Listen context boundaries

### Auth

`AuthContext.tsx` is now a thin facade over:

- `use-auth-session`
- `use-auth-oauth-sync`
- `use-auth-heartbeat`

### Offline

`OfflineContext.tsx` is now a thin facade over `use-offline-runtime`, which
keeps storage/sync logic out of the context shell itself.

### Player

`PlayerContext.tsx` is still the heaviest runtime module in Listen, but it is
no longer one undifferentiated monolith.

Important internal slices now include:

- `use-player-runtime-state`
- `use-player-engine-callbacks`
- `use-player-engine-sync`
- `use-player-queue-actions`
- `use-player-auth-sync`
- `use-play-event-tracker`
- `use-playback-persistence`
- `use-soft-interruption`
- `use-playback-intelligence`

The public `usePlayer()` contract remains stable while the implementation is
increasingly hook-oriented.

## Listen auth and platform boundary

The native boundary is also thinner now:

- `lib/capacitor.ts` is a facade
- OAuth parsing/persistence and runtime init live in dedicated modules
- server selection and per-server token storage live in `server-store.ts`

This is what supports the current multi-server Capacitor model.

## Test and quality gates

Listen now has an explicit quality gate:

- ESLint config in `app/listen/eslint.config.mjs`
- `npm run --workspace=app/listen lint`
- `npm run --workspace=app/listen typecheck`
- Vitest + Testing Library behavior tests
- reusable render harness in `src/test/render-with-listen-providers.tsx`

That test harness gives the app better behavior coverage around auth, routing,
offline state, and playback metadata flows.

## Data-fetching philosophy

Both apps still mostly use:

- declarative `useApi(...)` for page/section fetches
- imperative `api(...)` or `apiFetch(...)` for mutations and commands

But many complex surfaces now sit on top of snapshot/read-model endpoints rather
than bespoke “dashboard-only” assembly code inside the page itself.
