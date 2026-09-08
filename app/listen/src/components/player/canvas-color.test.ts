import { afterEach, describe, expect, it, vi } from "vitest";

import { readCanvasColorToken } from "@/lib/canvas-color";

describe("readCanvasColorToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a semantic CSS color and restores the inline color", () => {
    const canvas = document.createElement("canvas");
    canvas.style.color = "inherit";
    let observedColor = "";
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
      observedColor = canvas.style.color;
      return { color: "rgb(6, 182, 212)" } as CSSStyleDeclaration;
    });

    expect(readCanvasColorToken(canvas, "--accent-action")).toBe(
      "rgb(6, 182, 212)",
    );
    expect(observedColor).toBe("var(--accent-action)");
    expect(canvas.style.color).toBe("inherit");
  });

  it("returns null when the browser cannot resolve the token", () => {
    const canvas = document.createElement("canvas");
    const getComputedStyle = vi
      .spyOn(window, "getComputedStyle")
      .mockReturnValue({ color: "" } as CSSStyleDeclaration);

    expect(readCanvasColorToken(canvas, "--missing-token")).toBeNull();
    expect(canvas.style.color).toBe("");
    expect(getComputedStyle).toHaveBeenCalledWith(canvas);
  });
});
