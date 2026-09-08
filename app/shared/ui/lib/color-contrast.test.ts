import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  contrastRatioComposited,
  meetsWcagAa,
  parseCssColor,
  parseHexColor,
} from "./color-contrast";
import { SKIN_REGISTRY } from "./theme-skin";

describe("color contrast", () => {
  it("calculates WCAG contrast ratios for hex colors", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("rejects unsupported colors instead of reporting false confidence", () => {
    expect(parseHexColor("rgba(0, 0, 0, 0.5)")).toBeNull();
    expect(parseCssColor("color-mix(in srgb, white 50%, black)")).toBeNull();
    expect(contrastRatio("not-a-color", "#000000")).toBeNull();
  });

  it("composites alpha colors over an explicit surface", () => {
    expect(parseCssColor("rgba(255, 255, 255, 78%)")).toEqual({
      red: 255,
      green: 255,
      blue: 255,
      alpha: 0.78,
    });
    expect(parseCssColor("#ffffffcc")).toEqual({
      red: 255,
      green: 255,
      blue: 255,
      alpha: expect.closeTo(0.8, 2),
    });
    expect(meetsWcagAa("#ffffff", "#0a0a0f")).toBe(true);
    expect(
      contrastRatioComposited("rgba(255, 255, 255, 0.78)", "#0a0a0f"),
    ).toBeGreaterThan(4.5);
  });

  it("checks the translucent surface tokens against their canvas", () => {
    const surfaceTokens = readFileSync("tokens/themes.css", "utf8");
    const modalSurface = surfaceTokens.match(
      /--crate-token-surface-modal-solid:\s*(rgba\([^;]+\))/,
    )?.[1];

    expect(modalSurface).toBe("rgba(16, 16, 24, 0.95)");
    expect(
      contrastRatioComposited("#f1f5f9", modalSurface!, "#0a0a0f"),
    ).toBeGreaterThan(4.5);
  });

  it("requires an artwork backdrop instead of guessing through transparency", () => {
    expect(
      contrastRatioComposited("#ffffff", "rgba(10, 10, 15, 0.68)"),
    ).toBeNull();
    expect(
      contrastRatioComposited("#ffffff", "rgba(10, 10, 15, 0.68)", "#202020"),
    ).toBeGreaterThan(4.5);
  });

  it("keeps every explicit skin text pairing AA-compliant", () => {
    Object.values(SKIN_REGISTRY).forEach(({ modes }) => {
      Object.values(modes).forEach((variables) => {
        const foreground = variables["--color-foreground"];
        const muted = variables["--color-muted-foreground"];
        const panel = variables["--surface-panel"];
        const app = variables["--surface-app"];
        const primary = variables["--color-primary"];
        const primaryForeground = variables["--color-primary-foreground"];

        if (foreground && panel) {
          expect(meetsWcagAa(foreground, panel)).toBe(true);
        }
        if (muted && app) {
          expect(meetsWcagAa(muted, app)).toBe(true);
        }
        if (primary && primaryForeground) {
          expect(meetsWcagAa(primaryForeground, primary)).toBe(true);
        }
      });
    });
  });

  it("keeps the high-contrast Listen theme on the AA-safe base pairing", () => {
    const pairings = [
      ["#ffffff", "#000000"],
      ["#f1f5f9", "#000000"],
      ["#e2e8f0", "#000000"],
      ["#cbd5e1", "#000000"],
      ["#001014", "#67e8f9"],
      ["#000000", "#fca5a5"],
      ["#000000", "#86efac"],
      ["#000000", "#fde68a"],
      ["#000000", "#93c5fd"],
    ] as const;

    pairings.forEach(([foreground, background]) => {
      expect(meetsWcagAa(foreground, background)).toBe(true);
    });
  });

  it("keeps solid destructive controls on an AA-safe foreground", () => {
    const themeTokens = readFileSync("tokens/themes.css", "utf8");

    expect(themeTokens).toMatch(
      /--state-danger-foreground:\s*var\(--surface-canvas\)/,
    );
    expect(meetsWcagAa("#0a0a0f", "#ef4444")).toBe(true);
  });

  it("scopes appearance hooks to resolved color modes", () => {
    const themeTokens = readFileSync("tokens/themes.css", "utf8");

    expect(themeTokens).toMatch(/data-crate-mode="dark"/);
    expect(themeTokens).toMatch(/data-crate-mode="light"/);
    expect(themeTokens).not.toContain('data-crate-theme="high-contrast"');
  });
});
