# Documentation Platform and Hosted Site

## Purpose

Crate now has two parallel documentation surfaces:

- repository markdown under [`docs/`](/Users/diego/Code/Ninja/musicdock/docs)
- a hosted static documentation site rendered from those markdown files

The markdown in the repository remains the source of truth. The hosted site exists to make the same content easier to browse, search, and consume across environments.

This is an intentional product decision rather than a cosmetic extra. Crate has become large enough that raw markdown files are still valuable for authorship, but no longer ideal as the only reader experience.

## Product goals

The hosted docs site is meant to solve four problems:

1. make architecture documentation easier to discover than a flat filesystem tree
2. keep documentation visually aligned with the rest of the Crate product family
3. make documentation deployable as a first-class surface under the Crate domains
4. preserve repo-native markdown authoring so docs do not become trapped in a CMS

The site is therefore intentionally read-only and markdown-backed.

## Domains

The current intended domains are:

- `https://docs.cratemusic.app`
- `https://docs.dev.cratemusic.app`

This mirrors the same split used by other Crate surfaces:

- product/admin on their own subdomains
- API on its own host
- docs as a dedicated public surface

## Stack

The documentation site lives in [`app/docs`](/Users/diego/Code/Ninja/musicdock/app/docs).

It is built with:

- React 19
- React Router 7
- Vite
- Tailwind CSS 4
- `react-markdown`
- `remark-gfm`

This keeps the docs platform aligned with the frontend conventions already used in `app/ui` and `app/listen`.

## Visual system

The visual language intentionally borrows from Listen rather than from the desktop-oriented admin app:

- dark surfaces
- cyan accent
- Crate brand mark
- rounded editorial panels
- strong section navigation

That choice matters because the public documentation surface should feel closer to the user-facing product identity than to the operations/admin tooling identity.

## Content model

The hosted site currently exposes three content groups:

- `technical`
- `reference`
- `plans`

These correspond directly to the repo layout:

- [`docs/technical/`](/Users/diego/Code/Ninja/musicdock/docs/technical)
- top-level files under [`docs/`](/Users/diego/Code/Ninja/musicdock/docs)
- [`docs/plans/`](/Users/diego/Code/Ninja/musicdock/docs/plans)

The grouping is intentionally simple. It is not a CMS taxonomy; it is a navigation model over the existing repository structure.

## Source-of-truth stance

Markdown files in the repository are the canonical artifacts.

The site should never become the only place where documentation can be edited. That means:

- no database-backed docs store
- no in-browser editing
- no divergence between hosted content and committed markdown

This is an important operational decision. It keeps the documentation reviewable in pull requests and versioned with the code it describes.

## Rendering model

The site renders markdown using a thin frontend layer:

- sidebar navigation
- section landing pages
- search/filter over indexed docs
- rendered article page
- table of contents
- previous/next navigation

The frontend should stay intentionally lightweight. It is a documentation browser, not a docs authoring platform.

## Development wiring

In development:

- the docs frontend runs as a Vite dev server on port `5175`
- Caddy maps `https://docs.dev.cratemusic.app` to that server
- `make dev` starts the docs frontend alongside admin and listen

That wiring lives in:

- [`Makefile`](/Users/diego/Code/Ninja/musicdock/Makefile)
- [`data/caddy/Caddyfile.dev`](/Users/diego/Code/Ninja/musicdock/data/caddy/Caddyfile.dev)

This is deliberately consistent with how admin and listen are developed locally.

## Production wiring

In production the docs site is packaged as its own container:

- service: `crate-docs`
- image: `ghcr.io/diego-ninja/crate-docs`
- router host: `docs.${DOMAIN}`

The service definition lives in [`docker-compose.yaml`](/Users/diego/Code/Ninja/musicdock/docker-compose.yaml).

This makes the docs surface operationally independent from:

- `crate-ui`
- `crate-listen`
- `crate-api`

while still being deployed as part of the same stack.

## Why a separate app

The hosted docs site is a separate app rather than another route inside Listen or Admin for several reasons:

### Isolation

Documentation should be deployable and cacheable independently from the product shells.

### Public reach

The site may need a different auth posture from product surfaces over time.

### Visual focus

The docs experience wants a reading-oriented layout, not a player shell or admin shell.

### Simpler ownership

Keeping docs in `app/docs` avoids coupling documentation UX decisions to playback or admin concerns.

## Operational considerations

### Build context

The app needs access to repository markdown outside its own folder, so its container build uses the repository root as build context and copies both:

- `app/docs/`
- `docs/`

That is a subtle but important implementation detail.

### Freshness

The hosted docs should track repository state closely. If markdown changes but `crate-docs` is not rebuilt, the hosted site becomes stale.

In practice this means docs changes should be treated as deploy-relevant changes, not as static ancillary files.

### Safety

The site is static and should stay static. It should not require direct access to the main application database or background worker systems.

## Recommended future improvements

Good next steps for the platform include:

- generating a lightweight docs manifest at build time to reduce client bundle size
- adding richer deep-linking and anchor-copy UX
- adding diagrams and architecture maps for the largest subsystems
- optionally exposing last-updated metadata per document
- optionally publishing a public changelog for major architectural changes

## Boundaries

The docs platform should not become:

- an internal wiki with mutable runtime state
- a second source of truth for product configuration
- a place for undocumented business logic to live outside the codebase

Its role is to present committed technical knowledge in a more usable form.

## Related documents

- [System Overview](/Users/diego/Code/Ninja/musicdock/docs/technical/01-system-overview.md)
- [Development, Deployment, and Operations](/Users/diego/Code/Ninja/musicdock/docs/technical/10-development-deployment-and-operations.md)
- [Frontend Architecture: Admin and Listen](/Users/diego/Code/Ninja/musicdock/docs/technical/08-frontends-admin-and-listen.md)
