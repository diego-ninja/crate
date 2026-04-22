---
name: react-view-transitions
description: Guide for implementing smooth animations using React's View Transition API. Use when adding page transitions, animating route changes, creating shared element animations, animating enter/exit of components, animating list reorder, or implementing directional navigation animations. Triggers on mentions of view transitions, ViewTransition, transition types, or animating between UI states.
---

# React View Transitions

Animate between UI states using the browser's native `document.startViewTransition`. Declare *what* with `<ViewTransition>`, trigger *when* with `startTransition` / `useDeferredValue` / `Suspense`, control *how* with CSS classes.

## When to Apply

- Adding page/route transitions
- Shared element animations (list -> detail)
- Enter/exit animations for conditional content
- List reorder animations
- Suspense fallback-to-content reveals

## Key Concepts

- `<ViewTransition>` auto-assigns `view-transition-name` and calls `document.startViewTransition`
- Only `startTransition`, `useDeferredValue`, or `Suspense` activate VTs (not regular setState)
- Use `default="none"` liberally to prevent unwanted cross-fades
- Same `name` on two VTs creates shared element morph
- `addTransitionType` tags transitions for directional animations

## Animation Priority

| Priority | Pattern | What it communicates |
|----------|---------|---------------------|
| 1 | Shared element (`name`) | "Same thing - going deeper" |
| 2 | Suspense reveal | "Data loaded" |
| 3 | List identity (per-item `key`) | "Same items, new arrangement" |
| 4 | State change (`enter`/`exit`) | "Something appeared/disappeared" |
| 5 | Route change (layout-level) | "Going to a new place" |

## Reference Files

Read from `.agents/skills/vercel-react-view-transitions/references/`:

- `implementation.md` - Step-by-step implementation workflow
- `patterns.md` - Patterns, animation timing, events API, troubleshooting
- `css-recipes.md` - Ready-to-use CSS animation recipes
- `nextjs.md` - Next.js specific patterns (less relevant, we use React Router)

## Full Compiled Document

For the complete guide: `.agents/skills/vercel-react-view-transitions/AGENTS.md`
