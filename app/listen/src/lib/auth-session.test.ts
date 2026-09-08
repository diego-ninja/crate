import { beforeEach, describe, expect, it } from "vitest";

import {
  getApiAuthHeaders,
  getAuthToken,
  getAuthTokenExpiresAt,
  getRefreshToken,
  setAuthTokens,
} from "./auth-session";

beforeEach(() => {
  setAuthTokens(null, null, null);
});

describe("auth session", () => {
  it("stores the web session token and its expiry", () => {
    setAuthTokens("access-token", null, "2026-09-06T12:00:00.000Z");

    expect(getAuthToken()).toBe("access-token");
    expect(getAuthTokenExpiresAt()).toBe("2026-09-06T12:00:00.000Z");
    expect(getRefreshToken()).toBeNull();
  });

  it("derives expiry from a base64url JWT payload", () => {
    setAuthTokens("header.eyJleHAiOjE3NTcyMjQ4MDB9.signature");

    expect(getAuthTokenExpiresAt()).toBe("2025-09-07T06:00:00.000Z");
  });

  it("builds stable app and device headers without a web bearer token", () => {
    const headers = getApiAuthHeaders();

    expect(headers["X-Crate-App"]).toBeTruthy();
    expect(headers["X-Device-Label"]).toBeTruthy();
    expect(headers["X-Device-Fingerprint"]).toBeTruthy();
    expect(headers.Authorization).toBeUndefined();
  });
});
