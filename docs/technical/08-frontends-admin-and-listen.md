# Frontend Architecture: Admin and Listen

## Two products, one backend

Crate has two frontend applications and they are intentionally not the same app with two skins.

### Admin

- source: `https://github.com/diego-ninja/crate/blob/main/app/ui/src`
- purpose: library management, operations, repair, acquisition, analytics, settings
- orientation: desktop-first

### Listen

- source: `https://github.com/diego-ninja/crate/blob/main/app/listen/src`
- purpose: playback, browsing, discovery, social, mobile and PWA usage
- orientation: consumer-first, mobile-aware, Capacitor-ready

This split is one of the most important product decisions in Crate.

## Shared frontend core

Only a small set of utilities is shared through `https://github.com/diego-ninja/crate/blob/main/app/shared/web`:

- API helper
- route utilities
- generic `use-api`
- small utility functions

The shared layer is deliberately thin. Most UI and state logic remains product-specific.

## Admin app architecture

The admin app boots from [app/ui/src/App.tsx](https://github.com/diego-ninja/crate/blob/main/app/ui/src/App.tsx).

Core wrappers:

- `AuthProvider`
- `PlayerProvider`
- `NotificationProvider`
- `TooltipProvider`
- `Shell`

### Admin routing

The admin route tree includes:

- dashboard
- browse
- artist and album detail
- health
- download/acquisition
- insights and analysis
- tasks
- playlists
- stack
- genres
- timeline
- users
- discover
- settings
- profile
- new releases
- upcoming

This is effectively an operator console for the whole platform.

### Admin shell

The admin shell in [app/ui/src/components/layout/Shell.tsx](https://github.com/diego-ninja/crate/blob/main/app/ui/src/components/layout/Shell.tsx) is optimized for:

- desktop sidebar navigation
- dense search and command palette workflows
- keyboard shortcuts
- notifications
- a management-oriented player surface

It also includes mobile handling, but that is not the primary design target.

## Listen app architecture

The Listen app boots from [app/listen/src/App.tsx](https://github.com/diego-ninja/crate/blob/main/app/listen/src/App.tsx).

Core wrappers:

- `AuthProvider`
- `PlayerProvider`
- `ArtistFollowsProvider`
- `LikedTracksProvider`
- `SavedAlbumsProvider`
- `PlaylistComposerProvider`
- `Shell`

### Listen routing

Listen exposes the user-facing listening product:

- home
- explore
- search
- library
- stats
- upload
- settings
- people
- public user profiles
- jam sessions and invites
- playlist invites
- upcoming shows
- artist, album, playlist, curated playlist, home playlist pages

This route tree is closer to Spotify/Tidal than to a file manager.

### Listen shell

The Listen shell in [app/listen/src/components/layout/Shell.tsx](https://github.com/diego-ninja/crate/blob/main/app/listen/src/components/layout/Shell.tsx) is adaptive:

- desktop sidebar layout
- mobile bottom navigation
- floating/mobile player surfaces
- top bar with search and user affordances
- fixed shell chrome coordinated with playback presence

It is deliberately more presentation-heavy and responsive than the admin shell.

## State management approach

Neither app uses a global Redux-style store. Instead they rely on:

- React contexts
- route-local `useApi(...)`
- local component state
- specialized hooks per concern

This keeps the code relatively direct, but puts more responsibility on context design.

## Admin state domains

The admin app emphasizes:

- auth
- notifications
- task/event hooks
- command palette and keyboard utilities
- search-driven workflows
- a lightweight preview player

The admin player is intentionally minimal: a single `HTMLAudioElement`
behind a `PlayerContext` that exposes play/pause/seek. It is enough to
audition tracks while curating, not enough to replace Listen. No gapless,
no crossfade, no equalizer — those live in Listen.

## Listen state domains

Listen emphasizes:

- auth and heartbeat
- playback engine state
- follows
- likes
- saved albums
- playlist composition
- media session
- playback persistence
- soft interruption and recovery
- infinite playback intelligence

The Listen app is much more stateful because playback continuity is a first-class user expectation.

## Data fetching philosophy

Both apps mostly use:

- declarative `useApi(...)` for page/section fetches
- imperative `api(...)` for mutations and commands

This keeps contracts thin and close to route boundaries.

## UI libraries and styling

Both apps share the same broad frontend stack:

- React 19
- React Router 7
- Tailwind CSS 4
- shadcn/ui
- lucide-react
- sonner

But the visual language differs:

- admin favors dense information layout and tooling ergonomics
- listen favors immersive presentation and mobile-friendly affordances

## Charts and visualization

Admin and Listen use different visual emphases:

- admin uses more analysis and charts
- listen uses more artwork, motion, player chrome, and the WebGL visualizer

Nivo is the standard charting choice for new chart work.

## Capacitor and mobile stance

Listen is designed to be packaged for:

- PWA
- iOS via Capacitor
- Android via Capacitor

This affects several technical choices:

- auth cookie posture
- media session integration
- safe area handling
- responsiveness
- service worker considerations

Admin does not optimize for that same deployment target.

## Design decisions in the frontend layer

### Why not merge admin and listen

Because the user mental models are different:

- admin is for operators
- listen is for listeners

Trying to unify them would likely make both worse.

### Why keep shared code thin

Over-sharing between two distinct products usually creates lowest-common-denominator abstractions.

Crate instead shares:

- API contracts
- some route and helper logic

and lets each app keep its own UX and state model.

### Why contexts over a heavier client store

Crate's frontend state is domain-heavy but still fairly modular. Contexts and dedicated hooks are a reasonable middle ground:

- lighter than a large centralized store
- easier to keep close to the feature
- still composable enough for player/auth-level concerns

## Related documents

- [Auth, Sessions, Users, and Social Layer](/technical/auth-users-social-and-sessions)
- [Playback, Realtime, Visualizer, and Subsonic](/technical/playback-realtime-and-subsonic)
- [Development, Deployment, and Operations](/technical/development-deployment-and-operations)
