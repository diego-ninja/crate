import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  analyzeContent,
  analyzeRawColorDrift,
  analyzeSemanticTokens,
  buildDriftInventory,
} from "./drift-inventory.mjs";

test("counts raw colors, arbitrary utilities, inline styles and imports", () => {
  const metrics = analyzeContent(`
    <div className="bg-[#0a0a0f] bg-[rgba(0,0,0,0.5)] text-white border-cyan-500 text-[10px] bg-[var(--surface-card)]" style={{ color: "#fff" }} />
    import { Button } from "@crate/ui/shadcn/button";
    background: rgba(0, 0, 0, 0.5);
    function rgbToHsl() {}
    function hslToRgb() {}
  `);

  assert.deepEqual(metrics, {
    rawColors: 4,
    legacySemanticUtilities: 0,
    arbitraryUtilities: 4,
    hardcodedColorUtilities: 4,
    inlineStyles: 1,
    directShadcnImports: 1,
  });
});

test("detects legacy aliases on directional borders", () => {
  assert.equal(
    analyzeContent('className="border-t-primary border-b-destructive"')
      .legacySemanticUtilities,
    2,
  );
});

test("normalizes CSS whitespace when grouping semantic values", () => {
  const metrics = analyzeSemanticTokens(`
    :root {
      --surface-alpha: color-mix( in srgb, var(--text-primary) 5%, transparent );
      --surface-beta: color-mix(in srgb, var(--text-primary) 5%, transparent);
    }
  `);

  assert.equal(metrics.duplicateDefinitions, 1);
  assert.equal(metrics.actionableDuplicateDefinitions, 1);
  assert.deepEqual(metrics.duplicateTokenGroups, [
    ["--surface-alpha", "--surface-beta"],
  ]);
  assert.deepEqual(metrics.actionableDuplicateGroups, [
    ["--surface-alpha", "--surface-beta"],
  ]);
  assert.deepEqual(metrics.intentionalDuplicateGroups, []);
});

test("classifies token layers and counts external consumers", () => {
  const metrics = analyzeSemanticTokens(
    `
      :root {
        --surface-canvas: #000;
        --lyrics-glow: radial-gradient(var(--surface-canvas), transparent);
        --stats-hero: linear-gradient(var(--surface-canvas), transparent);
        --unused-recipe: #fff;
      }
      .lyrics { background: var(--lyrics-glow); }
      .stats { background: var(--stats-hero); }
      .canvas { background: var(--surface-canvas); }
    `,
    [
      `
        :root {
          --surface-canvas: #000;
          --lyrics-glow: radial-gradient(var(--surface-canvas), transparent);
          --stats-hero: linear-gradient(var(--surface-canvas), transparent);
          --unused-recipe: #fff;
        }
        .lyrics { background: var(--lyrics-glow); }
        .stats { background: var(--stats-hero); }
        .canvas { background: var(--surface-canvas); }
      `,
    ],
  );

  assert.equal(metrics.foundationDefinitions, 1);
  assert.equal(metrics.domainDefinitions, 2);
  assert.deepEqual(metrics.oneShotTokens, [
    { name: "--lyrics-glow", consumers: 1 },
    { name: "--stats-hero", consumers: 1 },
  ]);
  assert.deepEqual(metrics.unreferencedTokens, ["--unused-recipe"]);
});

test("counts quoted token references used by runtime readers", () => {
  const metrics = analyzeSemanticTokens(
    `
      :root {
        --visualizer-waveform-peak-idle: #000;
      }
    `,
    ['const token = "--visualizer-waveform-peak-idle";'],
  );

  assert.deepEqual(metrics.unreferencedTokens, []);
  assert.deepEqual(metrics.oneShotTokens, [
    { name: "--visualizer-waveform-peak-idle", consumers: 1 },
  ]);
});

test("counts Tailwind utility consumers through @theme bridges", () => {
  const metrics = analyzeSemanticTokens(`
    :root {
      --text-secondary: #cbd5e1;
      --action-shadow: 0 0 1px black;
      --state-danger-glow: 0 0 1px red;
    }
    @theme inline {
      --color-text-secondary: var(--text-secondary);
      --shadow-action: var(--action-shadow);
      --drop-shadow-state-danger: var(--state-danger-glow);
    }
    <div className="text-text-secondary hover:bg-text-secondary shadow-action drop-shadow-state-danger" />
  `);

  assert.equal(metrics.tokenConsumers["--text-secondary"], 3);
  assert.equal(metrics.tokenConsumers["--action-shadow"], 2);
  assert.equal(metrics.tokenConsumers["--state-danger-glow"], 2);
  assert.deepEqual(metrics.oneShotTokens, []);
});

test("separates foundation and intentional raw colors from product drift", () => {
  assert.deepEqual(
    analyzeRawColorDrift(
      "app/shared/ui/tokens/colors.css",
      "--color-primary: #06b6d4;",
    ),
    { foundationRawColors: 1, allowlistedRawColors: 0, actionableRawColors: 0 },
  );
  assert.deepEqual(
    analyzeRawColorDrift(
      "app/shared/ui/domain/auth/OAuthButtons.tsx",
      'fill="#4285F4" fill="#34A853" fill="#FBBC05" fill="#EA4335"',
    ),
    { foundationRawColors: 0, allowlistedRawColors: 4, actionableRawColors: 0 },
  );
  assert.deepEqual(
    analyzeRawColorDrift(
      "app/shared/ui/lib/theme-skin.ts",
      '"--color-primary": "#a78bfa", "--surface-modal": "rgba(17, 16, 30, 0.96)"',
    ),
    { foundationRawColors: 0, allowlistedRawColors: 2, actionableRawColors: 0 },
  );
  assert.deepEqual(
    analyzeRawColorDrift(
      "app/listen/src/components/Example.tsx",
      'style={{ color: "#123456" }}',
    ),
    { foundationRawColors: 0, allowlistedRawColors: 0, actionableRawColors: 1 },
  );
});

test("exposes ownership metadata for every raw color exception", () => {
  const inventory = buildDriftInventory();

  assert.deepEqual(inventory.rawColorAllowlist, [
    {
      path: "app/shared/ui/domain/auth/OAuthButtons.tsx",
      owner: "shared-ui",
      reason: "Provider brand colors must match Google's official OAuth mark.",
      reviewBy: "2026-12-31",
    },
    {
      path: "app/shared/ui/lib/theme-skin.ts",
      owner: "design-system",
      reason: "Curated skin values are runtime inputs for the skin registry.",
      reviewBy: "2026-12-31",
    },
    {
      path: "app/shared/ui/lib/appearance-resolver.ts",
      owner: "design-system",
      reason:
        "Scoped appearance previews need explicit runtime palette values for each preset and mode.",
      reviewBy: "2026-12-31",
    },
    {
      path: "app/listen/src/lib/capacitor-init.ts",
      owner: "listen-platform",
      reason: "Capacitor requires a fully transparent native status-bar color.",
      reviewBy: "2026-12-31",
    },
  ]);
});

test("detects surface tokens used in border and text declarations", () => {
  const metrics = analyzeSemanticTokens(`
    :root {
      --surface-quiet: color-mix(in srgb, white 10%, transparent);
    }
    .card {
      border: 1px solid var(--surface-quiet);
      color: var(--surface-quiet);
      background-color: var(--surface-quiet);
      background: var(--surface-quiet);
    }
  `);

  assert.deepEqual(metrics.roleViolations, [
    { property: "border", token: "--surface-quiet" },
    { property: "color", token: "--surface-quiet" },
  ]);
});

test("enforces the normalized semantic token budget", () => {
  const inventory = buildDriftInventory();
  assert.equal(inventory.version, 4);
  const metrics = inventory.semanticTokens;

  assert.deepEqual(metrics.nonFoundationAliases, []);
  assert.ok(
    metrics.definitions <= 220,
    `semantic token definitions grew to ${metrics.definitions}`,
  );
  assert.ok(
    metrics.foundationDefinitions <= 94,
    `foundation token definitions grew to ${metrics.foundationDefinitions}`,
  );
  assert.ok(
    metrics.domainDefinitions <= 114,
    `domain token definitions grew to ${metrics.domainDefinitions}`,
  );
  assert.equal(
    metrics.unreferencedTokens.length,
    0,
    `unreferenced semantic tokens: ${metrics.unreferencedTokens.join(", ")}`,
  );
  assert.deepEqual(
    metrics.roleViolations,
    [],
    `semantic role violations: ${JSON.stringify(metrics.roleViolations)}`,
  );
  assert.ok(
    inventory.totals.hardcodedColorUtilities <= 0,
    `hardcoded color utilities grew to ${inventory.totals.hardcodedColorUtilities}`,
  );
  assert.equal(inventory.totals.actionableRawColors, 0);
  assert.equal(inventory.totals.legacySemanticUtilities, 0);
  assert.ok(
    metrics.duplicateDefinitions <= 1,
    `semantic token duplicates grew to ${metrics.duplicateDefinitions}`,
  );
  assert.equal(metrics.actionableDuplicateDefinitions, 0);
  assert.deepEqual(metrics.actionableDuplicateGroups, []);
  assert.deepEqual(metrics.intentionalDuplicateGroups, [
    {
      tokens: ["--surface-contrast", "--state-danger-foreground"],
      reason:
        "The default skin shares the same value, but cards and destructive controls are separate semantic roles for future skins.",
    },
  ]);
  assert.deepEqual(metrics.duplicateTokenGroups, [
    ["--surface-contrast", "--state-danger-foreground"],
  ]);
});

test("keeps shared animation colors skin-aware", () => {
  const animations = readFileSync(
    new URL("../../app/shared/ui/tokens/animations.css", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(animations, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.match(animations, /var\(--accent-action\)/);
  assert.match(animations, /var\(--surface-glass-shadow\)/);
});

test("keeps runtime mode hooks isolated from semantic recipes", () => {
  const semantic = readFileSync(
    new URL("../../app/shared/ui/tokens/semantic.css", import.meta.url),
    "utf8",
  );
  const themes = readFileSync(
    new URL("../../app/shared/ui/tokens/themes.css", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(semantic, /data-crate-mode="(?:dark|light)"/);
  assert.doesNotMatch(themes, /data-crate-theme="high-contrast"/);
  assert.match(themes, /\[data-crate-app="listen"\]\[data-crate-mode="dark"\]/);
  assert.match(
    themes,
    /\[data-crate-app="listen"\]\[data-crate-mode="light"\]/,
  );
  assert.match(
    themes,
    /\[data-crate-app="listen"\]\[data-crate-mode="dark"\][\s\S]*--state-danger-foreground:\s*var\(--surface-canvas\)/,
  );
  assert.doesNotMatch(
    themes,
    /(?:^|[;{])\s*(?:margin|padding|width|height)\s*:/m,
  );
});
