import { describe, expect, it, vi } from "vitest";
import {
  createApiErrorReporter,
  safeRequestPath,
  scrubSentryEvent,
  type SentryApi,
} from "./sentry";

function createMockSentry() {
  const scope = {
    setTag: vi.fn(),
    setContext: vi.fn(),
  };
  const sentry: SentryApi = {
    captureException: vi.fn(),
    withScope: vi.fn((callback) => callback(scope)),
  };
  return { sentry, scope };
}

describe("shared Sentry helpers", () => {
  it("reports server failures with a safe request context", () => {
    const { sentry, scope } = createMockSentry();
    const report = createApiErrorReporter(sentry);
    const error = new Error("server failed");

    report(error, {
      method: "GET",
      url: "https://api.example.test/api/me?token=secret",
      status: 503,
    });

    expect(scope.setTag).toHaveBeenCalledWith("error.source", "api-client");
    expect(scope.setTag).toHaveBeenCalledWith("http.status_code", "503");
    expect(scope.setContext).toHaveBeenCalledWith("request", {
      method: "GET",
      url: "/api/me",
      status: 503,
    });
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "API request failed with HTTP 503",
      }),
    );
  });

  it("does not report aborts or expected client failures", () => {
    const { sentry } = createMockSentry();
    const report = createApiErrorReporter(sentry);

    report(new DOMException("aborted", "AbortError"), {
      method: "GET",
      url: "/api/me",
      status: 499,
    });
    report(new Error("validation"), {
      method: "POST",
      url: "/api/me",
      status: 422,
    });

    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("scrubs request data, credentials, user PII, and nested extras", () => {
    const event = scrubSentryEvent({
      request: {
        url: "https://api.example.test/api/me?token=secret",
        data: { password: "secret" },
        query_string: "token=secret",
        cookies: "session=secret",
        headers: { Authorization: "Bearer secret", Accept: "application/json" },
      },
      user: { id: 42, email: "person@example.test", ip_address: "192.0.2.1" },
      extra: { refresh_token: "secret", nested: { safe: true } },
    });

    expect(event.request).toEqual({
      url: "/api/me",
      method: undefined,
      data: undefined,
      query_string: undefined,
      cookies: undefined,
      headers: { Authorization: "[Filtered]", Accept: "application/json" },
    });
    expect(event.user).toEqual({ id: "42" });
    expect(event.extra).toEqual({
      refresh_token: "[Filtered]",
      nested: { safe: true },
    });
  });

  it("keeps only the path when URL parsing is unavailable", () => {
    expect(safeRequestPath("/api/search?q=secret")).toBe("/api/search");
  });
});
