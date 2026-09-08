import { describe, expect, it } from "vitest";

import { CONTENT_DENSITY_METRICS } from "./content-density";

describe("content density metrics", () => {
  it("keeps comfortable as the current baseline", () => {
    expect(CONTENT_DENSITY_METRICS.comfortable).toMatchObject({
      cardPadding: "0.5rem",
      gridGap: "1rem",
      railGap: "1rem",
      rowPaddingY: "0.625rem",
      rowEstimate: 72,
    });
  });

  it("bounds compact density without shrinking the row play target", () => {
    expect(CONTENT_DENSITY_METRICS.compact).toMatchObject({
      cardPadding: "0.25rem",
      gridGap: "0.75rem",
      railGap: "0.75rem",
      rowPaddingY: "0.375rem",
      rowEstimate: 64,
    });
    expect(CONTENT_DENSITY_METRICS.compact.rowEstimate).toBeLessThan(
      CONTENT_DENSITY_METRICS.comfortable.rowEstimate,
    );
  });
});
