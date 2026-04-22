---
name: react-best-practices
description: React performance optimization guidelines. Use when writing, reviewing, or refactoring React code to ensure optimal performance patterns. Triggers on tasks involving React components, data fetching, bundle optimization, or performance improvements.
---

# React Best Practices

Comprehensive performance optimization guide for React applications. Contains 70 rules across 8 categories, prioritized by impact.

## When to Apply

Reference these guidelines when:
- Writing new React components
- Implementing data fetching (client or server-side)
- Reviewing code for performance issues
- Refactoring existing React code
- Optimizing bundle size or load times

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Eliminating Waterfalls | CRITICAL | `async-` |
| 2 | Bundle Size Optimization | CRITICAL | `bundle-` |
| 3 | Server-Side Performance | HIGH | `server-` |
| 4 | Client-Side Data Fetching | MEDIUM-HIGH | `client-` |
| 5 | Re-render Optimization | MEDIUM | `rerender-` |
| 6 | Rendering Performance | MEDIUM | `rendering-` |
| 7 | JavaScript Performance | LOW-MEDIUM | `js-` |
| 8 | Advanced Patterns | LOW | `advanced-` |

## Key Rules (most relevant to this project)

### Eliminating Waterfalls (CRITICAL)
- `async-parallel` - Use Promise.all() for independent operations
- `async-defer-await` - Move await into branches where actually used
- `async-suspense-boundaries` - Use Suspense to stream content

### Bundle Size (CRITICAL)
- `bundle-barrel-imports` - Import directly, avoid barrel files
- `bundle-dynamic-imports` - Use dynamic imports for heavy components
- `bundle-defer-third-party` - Load analytics/logging after hydration

### Re-render Optimization (MEDIUM)
- `rerender-memo` - Extract expensive work into memoized components
- `rerender-derived-state-no-effect` - Derive state during render, not effects
- `rerender-no-inline-components` - Don't define components inside components
- `rerender-functional-setstate` - Use functional setState for stable callbacks

### Rendering Performance (MEDIUM)
- `rendering-conditional-render` - Use ternary, not && for conditionals
- `rendering-content-visibility` - Use content-visibility for long lists

## Detailed Rules

Read individual rule files from `.agents/skills/vercel-react-best-practices/rules/`.

## Full Compiled Document

For the complete guide with all rules expanded: `.agents/skills/vercel-react-best-practices/AGENTS.md`
