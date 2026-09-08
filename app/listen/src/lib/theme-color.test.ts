import { beforeEach, describe, expect, it, vi } from "vitest";

import { readThemeColor, syncThemeColor } from "./theme-color";

describe("theme color runtime", () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta name="theme-color" content="#000000">';
  });

  it("reads the resolved runtime surface instead of a fixed mode color", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) =>
        name === "--crate-token-surface-app" ? "#1c1c1e" : "",
    } as unknown as CSSStyleDeclaration);

    expect(readThemeColor(document.documentElement, "dark")).toBe("#1c1c1e");
  });

  it("updates the theme-color meta tag when the resolved appearance changes", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "#f5f5f7",
    } as unknown as CSSStyleDeclaration);

    expect(syncThemeColor(document.documentElement, "light")).toBe("#f5f5f7");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content,
    ).toBe("#f5f5f7");
  });

  it("falls back safely when runtime CSS is unavailable", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration);

    expect(readThemeColor(document.documentElement, "light")).toBe("#f8fafc");
  });
});
