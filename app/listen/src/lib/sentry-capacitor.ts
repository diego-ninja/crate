import * as Sentry from "@sentry/capacitor";
import { init as initReactSentry } from "@sentry/react";

import { scrubSentryEvent } from "../../../shared/web/sentry";

let initialized = false;

export function initNativeSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (initialized || !dsn) return;

  Sentry.init(
    {
      dsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || "development",
      release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
      sendDefaultPii: false,
      enableNative: true,
      enableNativeCrashHandling: true,
      enableCaptureFailedRequests: true,
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: parseSampleRate(
        import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
        0.1,
      ),
      beforeSend: scrubSentryEvent,
    },
    initReactSentry,
  );
  initialized = true;
}

function parseSampleRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}
