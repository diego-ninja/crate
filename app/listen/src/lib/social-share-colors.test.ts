import { describe, expect, it, vi } from "vitest";

import {
  readSocialShareColors,
  SOCIAL_SHARE_COLOR_TOKENS,
} from "./social-share-colors";

describe("social share colors", () => {
  it("maps every story color to a semantic CSS token", () => {
    expect(Object.values(SOCIAL_SHARE_COLOR_TOKENS)).toHaveLength(13);
    expect(
      Object.values(SOCIAL_SHARE_COLOR_TOKENS).every((token) =>
        token.startsWith("--"),
      ),
    ).toBe(true);
  });

  it("resolves the palette through the browser CSS cascade", () => {
    const element = document.createElement("span");
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (target) =>
        ({
          color:
            (target as HTMLElement).style.color.replace("var(", "resolved(") ||
            "",
        }) as CSSStyleDeclaration,
    );

    const colors = readSocialShareColors(element);

    expect(colors.cardSurface).toBe("resolved(--surface-contrast)");
    expect(colors.cardInk).toBe("resolved(--text-on-contrast)");
    expect(colors.accentGlow).toBe("resolved(--accent-action-glow-medium)");
  });
});
