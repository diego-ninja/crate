import { describe, expect, it } from "vitest";

import { shouldRedirectToLoginOnUnauthorized } from "@/lib/api";

describe("shouldRedirectToLoginOnUnauthorized", () => {
  it("skips redirect during public auth bootstrap routes", () => {
    expect(shouldRedirectToLoginOnUnauthorized("/login")).toBe(false);
    expect(shouldRedirectToLoginOnUnauthorized("/register")).toBe(false);
    expect(shouldRedirectToLoginOnUnauthorized("/server-setup")).toBe(false);
    expect(shouldRedirectToLoginOnUnauthorized("/auth/callback")).toBe(false);
  });

  it("redirects from protected app routes", () => {
    expect(shouldRedirectToLoginOnUnauthorized("/")).toBe(true);
    expect(shouldRedirectToLoginOnUnauthorized("/stats")).toBe(true);
  });
});
