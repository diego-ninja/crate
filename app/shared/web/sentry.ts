export interface SentryScope {
  setTag(key: string, value: string): void;
  setContext(key: string, value: Record<string, unknown>): void;
}

export interface SentryApi {
  captureException(error: Error): void;
  withScope(callback: (scope: SentryScope) => void): void;
}

export interface SentryEventLike {
  request?: {
    url?: string;
    method?: string;
    data?: unknown;
    query_string?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
  };
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
}

export interface SentryApiErrorContext {
  method: string;
  url: string;
  status?: number;
}

const SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "credential",
  "password",
  "secret",
  "token",
] as const;

export function createApiErrorReporter(sentry: SentryApi) {
  return (error: unknown, context: SentryApiErrorContext): void => {
    if (isAbortError(error)) return;
    if (
      context.status !== undefined &&
      context.status < 500 &&
      context.status !== 429
    ) {
      return;
    }

    const report =
      context.status === undefined
        ? error instanceof Error
          ? error
          : new Error(String(error))
        : new Error(`API request failed with HTTP ${context.status}`);
    sentry.withScope((scope) => {
      scope.setTag("error.source", "api-client");
      scope.setTag("http.method", context.method);
      if (context.status !== undefined) {
        scope.setTag("http.status_code", String(context.status));
      }
      scope.setContext("request", {
        method: context.method,
        url: safeRequestPath(context.url),
        ...(context.status === undefined ? {} : { status: context.status }),
      });
      sentry.captureException(report);
    });
  };
}

export function safeRequestPath(value: string): string {
  try {
    return new URL(value, window.location.origin).pathname;
  } catch {
    return value.split("?", 1)[0] || "/";
  }
}

export function scrubSentryEvent<T extends SentryEventLike>(event: T): T {
  if (event.request) {
    event.request = {
      ...event.request,
      url: event.request.url ? safeRequestPath(event.request.url) : undefined,
      data: undefined,
      query_string: undefined,
      cookies: undefined,
      headers: scrubHeaders(event.request.headers),
    };
  }
  if (event.user) {
    event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  }
  if (event.extra) event.extra = scrubMap(event.extra);
  if (event.contexts) event.contexts = scrubMap(event.contexts);
  if (event.tags) event.tags = scrubMap(event.tags);
  return event;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function scrubHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? "[Filtered]" : value,
    ]),
  );
}

function scrubMap(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? "[Filtered]" : scrubValue(value),
    ]),
  );
}

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === "object") {
    return scrubMap(value as Record<string, unknown>);
  }
  return value;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/-/g, "_");
  return SENSITIVE_KEYS.some((part) => normalized.includes(part));
}
