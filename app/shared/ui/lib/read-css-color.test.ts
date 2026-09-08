import { describe, expect, it, vi } from "vitest";

import { readCssColorToken } from "./read-css-color";

describe("readCssColorToken", () => {
  it("resolves a token and restores the element's inline color", () => {
    const element = document.createElement("span");
    element.style.setProperty("color", "red", "important");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      color: "rgb(6, 182, 212)",
    } as CSSStyleDeclaration);

    expect(readCssColorToken(element, "--accent-action")).toBe(
      "rgb(6, 182, 212)",
    );
    expect(element.style.getPropertyValue("color")).toBe("red");
    expect(element.style.getPropertyPriority("color")).toBe("important");
  });

  it("returns null when the browser cannot resolve the token", () => {
    const element = document.createElement("span");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      color: "",
    } as CSSStyleDeclaration);

    expect(readCssColorToken(element, "--missing-token")).toBeNull();
  });
});
