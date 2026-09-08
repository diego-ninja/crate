import { describe, expect, it } from "vitest";

import { getGenreColor } from "./show-types";

describe("getGenreColor", () => {
  it("returns a semantic genre tone for an exact genre", () => {
    expect(getGenreColor(["hardcore"])).toBe("var(--genre-tone-warm-strong)");
  });

  it("supports fuzzy matching without exposing raw colors", () => {
    expect(getGenreColor(["post-hardcore revival"])).toBe(
      "var(--genre-tone-warm)",
    );
  });

  it("falls back to the accent tone when genres are missing or unknown", () => {
    expect(getGenreColor()).toBe("var(--genre-tone-default)");
    expect(getGenreColor(["unknown genre"])).toBe("var(--genre-tone-default)");
  });
});
