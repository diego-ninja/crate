import { beforeEach, describe, expect, it } from "vitest";

import {
  getContentDensity,
  getContentDensityMetrics,
} from "@/lib/content-density";

describe("Listen content density", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-crate-density");
  });

  it("defaults to the comfortable baseline", () => {
    expect(getContentDensity()).toBe("comfortable");
    expect(getContentDensityMetrics().rowEstimate).toBe(72);
  });

  it("reads compact density from the applied appearance scope", () => {
    document.documentElement.dataset.crateDensity = "compact";

    expect(getContentDensity()).toBe("compact");
    expect(getContentDensityMetrics().rowEstimate).toBe(64);
  });
});
