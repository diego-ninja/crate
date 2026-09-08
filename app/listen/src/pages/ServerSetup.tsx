import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  ArrowRight,
  Server,
  AlertCircle,
  CheckCircle2,
} from "@crate/ui/icons";
import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";

import {
  addServer,
  isAllowedServerUrl,
  normaliseServerUrl,
  setCurrentServerId,
} from "@/lib/server-store";

/**
 * First-run setup for Capacitor builds. Lets the user point the app at
 * their Crate instance before anything else can happen.
 *
 * We deliberately don't use the shared `api` client here because that
 * client reads the current server from the store — and at this point
 * the store is empty. Instead we do a plain `fetch` against the probe
 * endpoint, then if it looks like a Crate server we persist it.
 */

type ProbeState =
  | { status: "idle" }
  | { status: "probing" }
  | { status: "ok"; inviteOnly: boolean }
  | { status: "not-crate" }
  | {
      status: "error";
      messageKey?:
        | "serverSetup.errors.connect"
        | "serverSetup.errors.host"
        | "serverSetup.errors.required";
      message?: string;
    };

async function probe(url: string): Promise<ProbeState> {
  try {
    const response = await fetch(`${url}/api/auth/config`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      // Upstream responded but not with 2xx. If it's a 404 the URL is
      // reachable but almost certainly isn't a Crate instance.
      return { status: "not-crate" };
    }
    const data = await response.json();
    if (data == null || typeof data !== "object") {
      return { status: "not-crate" };
    }
    // /api/auth/config returns { invite_only: bool, google: bool, ... }
    // — the presence of the config shape is enough to consider it Crate.
    const hasKnownField =
      "invite_only" in data || "google" in data || "apple" in data;
    if (!hasKnownField) return { status: "not-crate" };
    return {
      status: "ok",
      inviteOnly: Boolean((data as { invite_only?: boolean }).invite_only),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    return {
      status: "error",
      messageKey:
        message === "Load failed" || message === "Failed to fetch"
          ? "serverSetup.errors.connect"
          : message
            ? undefined
            : "serverSetup.errors.host",
      message: message || undefined,
    };
  }
}

export function ServerSetup() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [probeState, setProbeState] = useState<ProbeState>({ status: "idle" });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalised = normaliseServerUrl(url);
    if (!normalised) {
      setProbeState({
        status: "error",
        messageKey: "serverSetup.errors.required",
      });
      return;
    }
    if (
      !isAllowedServerUrl(normalised, {
        allowInsecureLoopback:
          import.meta.env.DEV &&
          import.meta.env.VITE_ALLOW_INSECURE_LOOPBACK === "true",
      })
    ) {
      setProbeState({
        status: "error",
        messageKey: "serverSetup.errors.host",
      });
      return;
    }
    setProbeState({ status: "probing" });
    const result = await probe(normalised);
    setProbeState(result);
    if (result.status === "ok") {
      const server = addServer(normalised);
      setCurrentServerId(server.id);
      // Give the checkmark a beat, then move on.
      window.setTimeout(() => navigate("/login", { replace: true }), 400);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-surface-canvas px-6 py-10 text-text-primary">
      <div className="server-setup-atmosphere pointer-events-none absolute inset-0" />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-[560px] rounded-[12px] border border-border-quiet bg-surface-elevated/90 p-8 shadow-card backdrop-blur-xl sm:p-10"
      >
        <div className="flex flex-col items-center text-center">
          <div className="mb-5 flex size-20 items-center justify-center rounded-xl border border-accent-action/20 bg-accent-action/10 shadow-accent-action-strong">
            <CrateLogo title="Crate" className="size-14" />
          </div>
          <h1 className="text-balance text-3xl font-bold tracking-[-0.04em] text-text-primary sm:text-4xl">
            {t("serverSetup.title")}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-text-secondary">
            {t("serverSetup.description")}
          </p>
        </div>

        <label className="mt-8 flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-text-muted">
            {t("serverSetup.urlLabel")}
          </span>
          <div className="relative">
            <Server
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-accent/50"
            />
            <input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.your-crate.com"
              className="h-14 w-full rounded-lg border border-border-quiet bg-text-primary/[0.04] pl-12 pr-4 text-base text-text-primary outline-none transition placeholder:text-text-muted/70 hover:border-text-primary/20 focus:border-accent-action/70 focus:bg-text-primary/[0.06] focus:shadow-focus"
              required
            />
          </div>
        </label>

        {/* Status strip. One line, changes tone based on probeState. */}
        <StatusLine state={probeState} />

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            type="submit"
            disabled={probeState.status === "probing"}
            className="group flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-accent-action px-5 text-sm font-semibold text-accent-action-foreground shadow-action-solid transition hover:bg-accent-action-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {probeState.status === "probing" ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {t("serverSetup.checking")}
              </>
            ) : (
              <>
                {t("serverSetup.continue")}
                <ArrowRight
                  size={16}
                  className="transition group-hover:translate-x-0.5"
                />
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setUrl("http://localhost:8585")}
            className="min-h-12 rounded-lg border border-border-quiet px-5 text-sm font-semibold text-text-secondary-strong transition hover:border-text-primary/20 hover:bg-text-primary/[0.05] hover:text-text-primary"
          >
            {t("serverSetup.localDev")}
          </button>
        </div>

        <p className="pt-5 text-center text-[0.75rem] leading-5 text-text-muted">
          {t("serverSetup.docsPrefix")}{" "}
          <a
            href="https://docs.cratemusic.app/technical/development-deployment-and-operations"
            className="text-text-accent underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            {t("serverSetup.docsLink")}
          </a>
          {t("serverSetup.docsSuffix")}
        </p>
      </form>
    </div>
  );
}

function StatusLine({ state }: { state: ProbeState }) {
  const { t } = useTranslation();
  if (state.status === "idle" || state.status === "probing") {
    return <div className="h-5" />; // Reserve space so the button doesn't jump
  }
  if (state.status === "ok") {
    return (
      <div className="flex items-center gap-2 text-[0.8125rem] text-state-success-text">
        <CheckCircle2 size={14} />
        {t("serverSetup.status.detected")}
        {state.inviteOnly ? ` ${t("serverSetup.status.inviteOnly")}` : ""}
      </div>
    );
  }
  if (state.status === "not-crate") {
    return (
      <div className="flex items-center gap-2 text-[0.8125rem] text-state-warning-text">
        <AlertCircle size={14} />
        {t("serverSetup.status.notCrate")}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-[0.8125rem] text-state-danger-text">
      <AlertCircle size={14} />
      {state.messageKey ? t(state.messageKey) : state.message}
    </div>
  );
}
