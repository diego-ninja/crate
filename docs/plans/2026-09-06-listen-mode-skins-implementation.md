# Listen Mode and Skins Implementation Plan

> **For agents:** REQUIRED SUB-SKILL: Use viterbit:executing-plans to implement this plan task-by-task.

**Goal:** Separate the user's color-mode preference (`dark`, `light`, `system`) from the visual skin, add light and dark variants for the default and Crate Red skins, and expose the selection in Listen Settings.

**Architecture:** The runtime stores a mode preference and a skin independently. `system` resolves to a concrete `dark` or `light` mode through `matchMedia`, including live OS preference changes. A skin provides mode-specific token overrides for identity, surfaces, rings, radii, shadows, and typography without changing layout or behavior. Legacy `theme-skin` values are migrated safely, with unsupported high-contrast selections falling back to `dark + default`.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS 4, CSS custom properties, Vitest, Testing Library.

---

### Task 1: Specify the new runtime contract with failing tests

**Files:**
- Modify: `app/shared/ui/lib/theme-skin.test.ts`
- Modify: `app/shared/ui/lib/theme-skin.ts`

**Step 1: Write the failing tests**

Cover:

- `mode` accepts `dark`, `light`, and `system`.
- `system` resolves from `matchMedia('(prefers-color-scheme: dark)')`.
- invalid and legacy persisted values fall back safely.
- `default` and `crate-red` are available in both concrete modes.
- `high-contrast` legacy data becomes `dark + default`.
- changing the system preference reapplies the resolved mode and does not leak listeners.

**Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test --workspace=app/shared/ui -- theme-skin.test.ts
```

Expected: failures for the new mode, migration, and system-listener behaviors.

**Step 3: Implement the minimal resolver and persistence contract**

Introduce `ColorModePreference`, `ResolvedColorMode`, `SkinId`, and `ThemeSkinSelection` with `mode` and `skin`. Keep `resolveThemeSkin` as a compatibility export only if existing callers require it, but make the new API authoritative.

**Step 4: Run the focused test and verify GREEN**

Run the same command. Expected: all focused tests pass.

**Step 5: Commit**

```bash
git add app/shared/ui/lib/theme-skin.ts app/shared/ui/lib/theme-skin.test.ts
git commit -m "feat: separate Listen modes from skins"
```

### Task 2: Add mode-aware token layers

**Files:**
- Modify: `app/shared/ui/lib/theme-skin.ts`
- Modify: `app/shared/ui/tokens/colors.css`
- Modify: `app/shared/ui/tokens/surfaces.css`
- Modify: `app/shared/ui/tokens/semantic.css`
- Modify: `app/shared/ui/tokens/typography.css`
- Modify: `app/shared/ui/tokens/themes.css`
- Modify: `app/shared/ui/lib/color-contrast.test.ts`

**Step 1: Extend the failing contract tests**

Assert that both skins expose dark/light token maps and that default-light and Crate Red pairings meet the existing contrast contract for primary text, muted text, controls, focus rings, and destructive actions.

**Step 2: Run tests and verify RED**

Run:

```bash
npm run test --workspace=app/shared/ui -- theme-skin.test.ts color-contrast.test.ts
```

Expected: missing light and Crate Red definitions fail.

**Step 3: Implement the token layers**

- Keep mode-neutral foundations in the shared token files.
- Add explicit light-mode base values for canvas, panels, text, borders, inputs, scrollbars, and state colors.
- Replace `aurora` with `crate-red`, each with explicit dark/light overrides.
- Expand the skin allowlist only for existing semantic roles: accent, focus/ring, curated surface roles, border roles, radius scale, shadow/glow roles, and brand font.
- Keep layout, spacing, control sizes, and behavior outside the skin contract.

**Step 4: Run focused tests and verify GREEN**

Run the focused command above. Expected: all mode/skin and contrast tests pass.

**Step 5: Commit**

```bash
git add app/shared/ui/lib/theme-skin.ts app/shared/ui/lib/color-contrast.test.ts app/shared/ui/tokens
git commit -m "feat: add light and Crate Red token variants"
```

### Task 3: Wire runtime initialization and system preference changes

**Files:**
- Modify: `app/shared/ui/lib/theme-skin.ts`
- Modify: `app/listen/src/main.tsx`
- Modify: `app/listen/src/test-setup.ts`
- Modify: `app/shared/ui/lib/theme-skin.test.ts`

**Step 1: Add failing lifecycle tests**

Test initialization from storage, application of `data-crate-mode`, `data-crate-mode-preference`, and `data-crate-skin`, plus live `MediaQueryList` change handling only while mode is `system`.

**Step 2: Run focused tests and verify RED**

```bash
npm run test --workspace=app/shared/ui -- theme-skin.test.ts
```

**Step 3: Implement lifecycle handling**

Apply the resolved mode before rendering, persist only the preference and skin, cache the storage read per initialization, and clean up the media-query listener when the preference changes away from `system`.

**Step 4: Run focused tests and verify GREEN**

Run the same command.

**Step 5: Commit**

```bash
git add app/shared/ui/lib/theme-skin.ts app/listen/src/main.tsx app/listen/src/test-setup.ts app/shared/ui/lib/theme-skin.test.ts
git commit -m "feat: support system color mode detection"
```

### Task 4: Update the Settings selector and translations

**Files:**
- Modify: `app/listen/src/components/settings/ThemeSkinSection.tsx`
- Modify: `app/listen/src/pages/Settings.tsx`
- Modify: `app/listen/src/i18n/catalogs/*.json`
- Add or modify: `app/listen/src/components/settings/ThemeSkinSection.test.tsx`

**Step 1: Write failing component tests**

Cover rendering of the three mode choices, the two skin choices, disabled/incompatible states, immediate application, and the resolved system-mode label.

**Step 2: Run tests and verify RED**

```bash
npm run test --workspace=app/listen -- ThemeSkinSection.test.tsx
```

**Step 3: Implement the Settings UI**

Use accessible radio groups. Keep the existing settings section placement, show `Dark`, `Light`, and `System`, and show `Default` and `Crate Red` with concise descriptions and color swatches. Do not add a separate high-contrast option.

**Step 4: Run tests and verify GREEN**

Run the focused component test and the i18n checker.

**Step 5: Commit**

```bash
git add app/listen/src/components/settings app/listen/src/pages/Settings.tsx app/listen/src/i18n/catalogs
git commit -m "feat: add Listen mode and skin selector"
```

### Task 5: Verify visual parity, accessibility, and quality gates

**Files:**
- Modify: `docs/technical/listen-design-system-visual-qa.md`
- Modify: `.decisions/implementation-plan.md`

**Step 1: Run focused and full checks**

```bash
npm run test --workspace=app/shared/ui
npm run test --workspace=app/listen -- --pool=threads --maxWorkers=1
npm run typecheck --workspace=app/shared/ui
npm run typecheck --workspace=app/listen
npm run lint --workspace=app/listen
npm run i18n:check --workspace=app/listen
npm run build --workspace=app/shared/ui
npm run build --workspace=app/listen
npm run design-system:layers
node --test scripts/design-system/*.test.mjs
git diff --check
```

**Step 2: Run React Doctor on the branch diff**

```bash
npx react-doctor@latest --project "app/shared/ui,app/ui,app/listen,app/listen-desktop,app/docs,app/site" --scope changed --include-untracked --base main --no-parallel --no-telemetry
```

Expected: no new issues.

**Step 3: Perform browser QA**

Check Settings and representative Listen surfaces in:

- default light
- default dark
- system resolving to light and dark
- Crate Red light
- Crate Red dark
- mobile and desktop
- keyboard focus and reduced motion

**Step 4: Update evidence and commit**

Record the supported combinations, migration behavior, and QA results in the visual QA document and implementation plan.

```bash
git add docs/technical/listen-design-system-visual-qa.md .decisions/implementation-plan.md
git commit -m "docs: record mode and skin rollout"
```

### Task 6: Push and review CI

**Step 1: Push all implementation commits**

```bash
git push origin codex/listen-design-system
```

**Step 2: Check React Doctor and persistent review for the latest commit**

Use the GitHub integration to verify the review comment and status check. If a finding appears, fix it in a follow-up cut, rerun the relevant checks, commit, push, and recheck the review before closing the plan.

