import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Loader2, ArrowRight, Server, AlertCircle, CheckCircle2 } from "lucide-react";

import { ApiError } from "@/lib/api";
import { addServer, normaliseServerUrl, setCurrentServerId } from "@/lib/server-store";

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
  | { status: "error"; message: string };

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
    return { status: "ok", inviteOnly: Boolean((data as { invite_only?: boolean }).invite_only) };
  } catch (err) {
    if (err instanceof ApiError) {
      return { status: "error", message: err.message };
    }
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Could not reach that host",
    };
  }
}

export function ServerSetup() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [probeState, setProbeState] = useState<ProbeState>({ status: "idle" });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalised = normaliseServerUrl(url);
    if (!normalised) {
      setProbeState({ status: "error", message: "Enter a server URL" });
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-app-surface px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center pb-2">
          <img src="/icons/logo.svg" alt="Crate" className="mb-2 h-16 w-16" />
          <h1 className="text-2xl font-bold text-white">Connect to a Crate server</h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Point the app at your Crate instance. You can add more later from Settings.
          </p>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Server URL
          </span>
          <div className="relative">
            <Server
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
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
              className="h-12 w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-3 text-[15px] text-white outline-none placeholder:text-white/40 focus:border-cyan-400/60"
              required
            />
          </div>
        </label>

        {/* Status strip. One line, changes tone based on probeState. */}
        <StatusLine state={probeState} />

        <button
          type="submit"
          disabled={probeState.status === "probing"}
          className="group flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 py-3 text-sm font-semibold text-[#05161c] shadow-[0_0_24px_-6px_rgba(6,182,212,0.6)] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {probeState.status === "probing" ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Reaching the server…
            </>
          ) : (
            <>
              Continue
              <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
            </>
          )}
        </button>

        <p className="pt-2 text-center text-[12px] leading-5 text-white/40">
          Don't run your own server yet?{" "}
          <a
            href="https://docs.cratemusic.app/technical/development-deployment-and-operations"
            className="text-cyan-300 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Set one up in ~5 minutes
          </a>
          .
        </p>
      </form>
    </div>
  );
}

function StatusLine({ state }: { state: ProbeState }) {
  if (state.status === "idle" || state.status === "probing") {
    return <div className="h-5" />; // Reserve space so the button doesn't jump
  }
  if (state.status === "ok") {
    return (
      <div className="flex items-center gap-2 text-[13px] text-emerald-300">
        <CheckCircle2 size={14} />
        Crate instance detected{state.inviteOnly ? " (invite-only)" : ""}
      </div>
    );
  }
  if (state.status === "not-crate") {
    return (
      <div className="flex items-center gap-2 text-[13px] text-amber-300">
        <AlertCircle size={14} />
        Reachable, but not a Crate server
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-[13px] text-rose-300">
      <AlertCircle size={14} />
      {state.message}
    </div>
  );
}
