# Crate — Business Roadmap

Date: 2026-05-05

Horizons ordered by impact on retention, adoption, and differentiation.

---

## Horizon 0: Foundations for Growth (0–3 months)

What prevents Crate from being recommendable to non-technical users. Without this, everything else is irrelevant.

### H0.1 — i18n / Internationalization

**Priority: CRITICAL**

**Why first:** Every hardcoded English string added now is debt to pay later. 80% of the world does not speak English as a first language. Spanish, French, Portuguese, German, and Japanese-speaking communities are massive markets of music lovers.

**Scope:**
- Choose library: `react-i18next` (more mature, massive ecosystem) or `lingui` (lighter, better DX with macros). Recommendation: `react-i18next` for React 19 ecosystem compatibility.
- Extract all strings from `app/listen` and `app/ui` into JSON namespaces
- Initial locales: `en`, `es`, `fr`, `de`, `pt`, `ja`
- Auto-detect browser language with manual selector
- Date, number, and duration formatting via `Intl` per locale (remove hardcoded `"en-US"` in `Shows.tsx:80`, `ArtistPageSections.tsx:146`)
- Document translation process for contributors
- CI check: `i18next-parser` to detect untranslated keys

**Effort:** 2-3 weeks. **Impact:** Unlocks global adoption.

### H0.2 — Bandcamp Integration

**Priority: CRITICAL**

**Why first:** It's the answer to "how do I get music?". Bandcamp is the ethical platform par excellence. The manifesto asks people to buy music — Crate must facilitate it from within.

**Scope (Phase 1):**
- **Purchase links on artist page:** Search Bandcamp by artist name + entity (`bandcamp.com/search?q=...`). Show "Buy on Bandcamp" link with icon.
- **Purchase links on album page:** Same for album. If album has `bandcamp_url` in metadata, use it directly.
- **"Support this artist" section:** On artist page, a card saying "Own their music" with links to Bandcamp, merch (if available), official website.

**Scope (Phase 2):**
- **Bandcamp discovery feed:** "Artists you might like on Bandcamp" — cross Last.fm similar artists with Bandcamp search. List of related artists NOT in your library, with link to their Bandcamp.
- **Import from Bandcamp purchases:** Detect Bandcamp download folder and map to artists already in library.

**Effort:** 1-2 weeks (Phase 1). **Impact:** Closes the product's biggest gap.

### H0.3 — Discography Timeline on Artist Page

**Priority: HIGH**

**Why:** The Listen artist page already loads albums sorted by year, but as a grid. A visual timeline is the difference between "database" and "music experience". Spotify, Tidal, and Apple Music all have it.

**Scope:**
- `DiscographyTimeline` component: horizontal with years as milestones
- Group albums by year/era
- Show cover art, title, type (LP/EP/Single/Compilation)
- Decade navigation (jump to 1990s, 2000s, etc.)
- Integrated below the hero on Listen Artist page
- Reuses already loaded data (no new API needed)

**Effort:** 3-5 days. **Impact:** Drastically elevates perceived quality.

### H0.4 — Music Acquisition Guide

**Priority: HIGH**

**Why:** The manifesto says "download the music" but there is no onboarding. A new user opens Crate, sees 0 songs, and leaves.

**Scope:**
- **Smart empty state:** If library is empty, show "Start your library" screen instead of empty grid
- 3 paths: "I have music files" (mount /music), "I want to buy music" (Bandcamp/Qobuz/7digital guide), "I want to rip my CDs" (quick guide)
- **Library progress bar:** "You have 12 artists. The average Crate instance has 200+" — soft gamification
- **Import wizard:** Detect typical folder structures (Bandcamp, downloads, rips) and suggest actions

**Effort:** 1-2 weeks. **Impact:** Reduces onboarding abandonment.

---

## Horizon 1: Engagement & Retention (3–6 months)

Once the user has music, make them come back.

### H1.1 — Crate Wrapped

**Priority: CRITICAL**

**Why:** Spotify Wrapped is the largest organic marketing event in the music industry. Crate already has all the data (`user_play_events`, `user_track_stats`, `user_artist_stats`, `user_genre_stats`, `user_daily_listening`). It just needs packaging.

**Scope:**
- **Wrapped page in Listen:** Narrative slideshow experience (5-7 screens) with animations
  - Slide 1: "You listened to X hours of music this year"
  - Slide 2: "Your top genre was X. You listened to Y different genres total"
  - Slide 3: "Your top artist was X (Z minutes). Here's what your year with them looked like"
  - Slide 4: "Your top album was X. You played it Y times"
  - Slide 5: "Your top track was X. You played it at Y different times of day"
  - Slide 6: "Your listening personality" (based on patterns: Night Owl, Explorer, Loyalist, Diver, etc.)
  - Slide 7: "Share your Wrapped" — generates shareable image/card
- **Share card generator:** SVG/Canvas rendering a visual summary for sharing on social/messaging
- **New endpoints:** `GET /api/me/stats/annual/{year}` with pre-aggregated year data
- **Notification:** "Your Crate Wrapped is ready" on entering January
- **History:** Access to previous years' Wrapped

**Effort:** 3-4 weeks. **Impact:** Massive engagement, organic virality, absolute differentiation (Navidrome/Ampache/Plex don't have this).

### H1.2 — Social Features Depth

**Priority: HIGH**

**Why:** Crate positions itself for "groups of friends, small communities". Current social features are superficial.

**Scope:**
- **Activity feed:** "Diego played Dark Horse by Converge", "Maria added 3 albums to her library", "Carlos created a playlist". Visible on Home as optional section.
- **Sync listening (Jam Room v2):** WebSocket so multiple users listen to exactly the same thing at once. One host controls the queue, others are spectators. Side chat.
- **Cross-user recommendations:** "Since you and Diego both like Converge, try his playlist 'Best of Hardcore'"
- **Real-time collaborative playlists:** WebSocket for add/remove/reorder tracks with presence (who added what)
- **Public profile:** Profile page with top artists, public playlists, summarized stats

**Effort:** 4-6 weeks. **Impact:** Transforms Crate from individual tool to social platform.

### H1.3 — Notifications & Activity

**Priority: MEDIUM**

**Why:** Without notifications, users only see changes when they open the app.

**Scope:**
- **In-app notifications:** Bell icon in Listen with event feed
- **Types:** "New release from X", "X is playing near you", "Your friend added Y albums", "Crate Wrapped is ready"
- **Push notifications (Capacitor):** Native only (iOS/Android), for new releases from followed artists
- **Email digest (optional):** Weekly summary "This week in your library"

**Effort:** 2-3 weeks. **Impact:** Retention and re-engagement.

---

## Horizon 2: Discovery & Reach (6–12 months)

### H2.1 — External Discovery

**Priority: HIGH**

**Why:** Crate is excellent at navigating your library, but doesn't help expand it. Spotify tells you what to listen to. Crate should tell you what to buy.

**Scope:**
- **"If you like X, try Y on Bandcamp":** Home section crossing Last.fm similar artists with Bandcamp search. Artists NOT in your library.
- **Release alerts:** "Artists similar to what you follow just released new music on Bandcamp"
- **Local scene:** "Artists playing near you this month that you don't own yet". Cross Ticketmaster shows with your geolocation and filter out ones you already have.
- **Export to wishlist:** "Save to Bandcamp wishlist" from within Crate

**Effort:** 3-4 weeks. **Impact:** Closes the discovery gap without betraying the ethical model.

### H2.2 — Cross-Device Playback

**Priority: MEDIUM**

**Why:** WebRTC or Subsonic already enable remote control. Packaging it as "Crate Cast" is a wow factor.

**Scope:**
- **"Play on..." button:** From mobile, send playback to desktop instance
- **Remote control:** Phone as remote control for the main system
- **Chromecast support:** Via Capacitor plugin or Subsonic

**Effort:** 3-4 weeks. **Impact:** Premium feel.

### H2.3 — Accessibility (a11y)

**Priority: MEDIUM**

**Why:** WCAG 2.1 AA is a requirement for Crate to be usable by people with visual, motor, or cognitive disabilities. It's also a political statement: music is for everyone.

**Scope:**
- Audit with axe-core / Lighthouse
- Full keyboard navigation
- Screen reader: labels on all controls, correct landmarks, state change announcements
- Color contrast and high contrast mode
- Reduce animations for `prefers-reduced-motion`
- Scalable fonts without breaking layout

**Effort:** 2-3 weeks. **Impact:** Real inclusion, not posturing.

### H2.4 — Mobile Experience Maturity

**Priority: MEDIUM**

**Why:** iOS pending. Listen is PWA + Android. iOS via Capacitor is planned but not implemented.

**Scope:**
- Functional iOS Capacitor build
- Native gestures (swipe back, pull to refresh, haptic feedback)
- Audio background mode on iOS (info center, controls)
- CarPlay / Android Auto
- Widget: "Now Playing" or "Recently Played" on home screen

**Effort:** 4-6 weeks. **Impact:** iOS audience = ~50% of mobile market in wealthy countries.

---

## Horizon 3: Platform (12+ months)

### H3.1 — Multi-Instance Community Management

**Priority: MEDIUM**

**Why:** The pitch is "groups of friends, small communities". But currently each community needs its own server, its own DB, its own admin. Light federation would allow sharing without centralization.

**Scope:**
- **Connected instances:** Two Crate instances can share artist/album catalog (not files, just metadata)
- **"Discover on other instances":** See what other friendly instances are listening to
- **Shared playlists across instances:** A link that works cross-instance
- **ActivityPub (long term):** Compatibility with Mastodon/Lemmy for sharing music activity in the fediverse

**Effort:** 8-12 weeks. **Impact:** Transforms Crate into a protocol, not just a product.

### H3.2 — Plugin / App Ecosystem

**Priority: LOW**

**Why:** "Hackable by design" is already in the value props. Take it to the extreme.

**Scope:**
- **Plugin API:** Hooks to extend enrichment pipeline, add data sources, modify UI
- **Community marketplace:** Plugins shared between instances
- **Visual themes:** Skins for Listen and Admin

**Effort:** 8-16 weeks. **Impact:** Long-tail functionality without central maintenance.

### H3.3 — Editorial / Community Curation

**Priority: LOW**

**Why:** Human curation is the antidote to the algorithm. Crate already has the base (playlists, follows, stats). Add editorial layer.

**Scope:**
- **"Crate Picks":** Community-curated playlists, highlighted on Home
- **Album reviews:** Personal notes on albums, visible to friends
- **"Listening club":** Album of the week, thread discussion

**Effort:** 4-6 weeks. **Impact:** Differentiation from algorithmic recommendation.

---

## Prioritized Summary

| # | Initiative | Horizon | Effort | Impact | Blocker |
|---|-----------|---------|--------|--------|---------|
| 1 | i18n | H0 | 2-3 wk | Critical | None |
| 2 | Bandcamp integration | H0 | 1-2 wk | Critical | None |
| 3 | Discography timeline | H0 | 3-5 days | High | None |
| 4 | Music acquisition guide | H0 | 1-2 wk | High | None |
| 5 | Crate Wrapped | H1 | 3-4 wk | Critical | Play events (done) |
| 6 | Social features depth | H1 | 4-6 wk | High | None |
| 7 | Notifications | H1 | 2-3 wk | Medium | None |
| 8 | External discovery | H2 | 3-4 wk | High | Bandcamp (H0.2) |
| 9 | Cross-device playback | H2 | 3-4 wk | Medium | None |
| 10 | Accessibility | H2 | 2-3 wk | Medium | None |
| 11 | Mobile maturity (iOS) | H2 | 4-6 wk | Medium | Capacitor base |
| 12 | Multi-instance | H3 | 8-12 wk | Medium | None |
| 13 | Plugin ecosystem | H3 | 8-16 wk | Low | Stabilized API |
| 14 | Editorial community | H3 | 4-6 wk | Low | Social (H1.2) |
