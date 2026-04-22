---
name: composition-patterns
description:
  React composition patterns that scale. Use when refactoring components with
  boolean prop proliferation, building flexible component libraries, or
  designing reusable APIs. Triggers on tasks involving compound components,
  render props, context providers, or component architecture. Includes React 19
  API changes.
---

# React Composition Patterns

Composition patterns for building flexible, maintainable React components. Avoid
boolean prop proliferation by using compound components, lifting state, and
composing internals.

## When to Apply

Reference these guidelines when:

- Refactoring components with many boolean props
- Building reusable component libraries
- Designing flexible component APIs
- Reviewing component architecture
- Working with compound components or context providers

## Rule Categories by Priority

| Priority | Category                | Impact | Prefix          |
| -------- | ----------------------- | ------ | --------------- |
| 1        | Component Architecture  | HIGH   | `architecture-` |
| 2        | State Management        | MEDIUM | `state-`        |
| 3        | Implementation Patterns | MEDIUM | `patterns-`     |
| 4        | React 19 APIs           | MEDIUM | `react19-`      |

## Detailed Rules

Read individual rule files from `.agents/skills/vercel-composition-patterns/rules/`:

- `architecture-avoid-boolean-props.md` - Don't add boolean props to customize behavior; use composition
- `architecture-compound-components.md` - Structure complex components with shared context
- `state-decouple-implementation.md` - Provider is the only place that knows how state is managed
- `state-context-interface.md` - Define generic interface with state, actions, meta for dependency injection
- `state-lift-state.md` - Move state into provider components for sibling access
- `patterns-explicit-variants.md` - Create explicit variant components instead of boolean modes
- `patterns-children-over-render-props.md` - Use children for composition instead of renderX props
- `react19-no-forwardref.md` - Don't use `forwardRef`; use `use()` instead of `useContext()`

## Full Compiled Document

For the complete guide with all rules expanded: `.agents/skills/vercel-composition-patterns/AGENTS.md`
