import {
  createApiErrorReporter,
  scrubSentryEvent,
} from "../../../shared/web/sentry";
import type { ErrorInfo } from "react";

let initialized = false;
let initialization: Promise<void> | null = null;
let sentryModulePromise: Promise<SentryModule | null> | null = null;
let apiErrorReporter: ReturnType<typeof createApiErrorReporter> | null = null;

export function initSentry(): Promise<void> {
  const dsn = getDsn();
  if (initialized || !dsn) return Promise.resolve();
  if (initialization) return initialization;

  initialization = loadSentry().then((sentry) => {
    if (!sentry || initialized) return;

    sentry.init({
      dsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || "development",
      release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
      sendDefaultPii: false,
      integrations: [sentry.browserTracingIntegration()],
      tracesSampleRate: parseSampleRate(
        import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
        0.1,
      ),
      beforeSend: scrubSentryEvent,
    });
    initialized = true;
  });

  return initialization;
}

export function captureApiError(
  error: unknown,
  context: Parameters<ReturnType<typeof createApiErrorReporter>>[1],
): void {
  void withSentry((sentry) => {
    apiErrorReporter ??= createApiErrorReporter(sentry);
    apiErrorReporter(error, context);
  });
}

export function captureRenderError(error: Error, info: ErrorInfo): void {
  void withSentry((sentry) => {
    sentry.withScope((scope) => {
      scope.setExtra("react.component_stack", info.componentStack);
      sentry.captureException(error);
    });
  });
}

export function setSentryUser(userId: number | string | null): Promise<void> {
  return withSentry((sentry) => {
    sentry.setUser(userId == null ? null : { id: String(userId) });
  });
}

type SentryModule = typeof import("@sentry/react");

function getDsn(): string {
  return import.meta.env.VITE_SENTRY_DSN?.trim() || "";
}

function loadSentry(): Promise<SentryModule | null> {
  return (sentryModulePromise ??= import("@sentry/react").catch(() => null));
}

function withSentry(callback: (sentry: SentryModule) => void): Promise<void> {
  if (!getDsn()) return Promise.resolve();

  return initSentry()
    .then(() => loadSentry())
    .then((sentry) => {
      if (sentry) callback(sentry);
    });
}

function parseSampleRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}
