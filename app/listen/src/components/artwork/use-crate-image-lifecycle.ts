import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { ImgHTMLAttributes, SyntheticEvent } from "react";

import {
  preloadArtwork,
  preloadResolvedArtwork,
  refreshArtworkCandidate,
  resolveArtworkCandidate,
  type ResolvedArtworkCandidate,
} from "@/lib/artwork-manager";
import { requiresMediaAccessTicket } from "@/lib/api";
import type { ArtworkSource } from "@/lib/artwork-source";

import {
  EVENTUAL_RETRY_DELAYS_MS,
  retryCandidate,
  shouldRefreshAfterResume,
} from "./crate-image-model";

interface ActiveArtwork {
  candidate: ResolvedArtworkCandidate;
  ready: boolean;
}

interface UseCrateImageLifecycleOptions {
  artwork: ArtworkSource;
  resolved: ResolvedArtworkCandidate | null;
  preservesReadyArtwork: boolean;
  resumeVersion: number;
  loading: ImgHTMLAttributes<HTMLImageElement>["loading"];
  onError?: (event: SyntheticEvent<HTMLImageElement, Event>) => void;
  onLoad?: (event: SyntheticEvent<HTMLImageElement, Event>) => void;
}

export function useCrateImageLifecycle({
  artwork,
  resolved,
  preservesReadyArtwork,
  resumeVersion,
  loading,
  onError,
  onLoad,
}: UseCrateImageLifecycleOptions) {
  const [active, dispatch] = useReducer(
    activeArtworkReducer,
    resolved,
    createInitialActiveArtwork,
  );
  const activeRef = useRef(active);
  const desiredRef = useRef(resolved ? candidateKey(resolved) : "");
  const handledResumeVersion = useRef(resumeVersion);
  const recoveryAttempts = useRef(0);
  const mountedRef = useRef(true);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const commit = useCallback((next: ActiveArtwork | null) => {
    activeRef.current = next;
    dispatch({ type: "replace", value: next });
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const desired = resolved ? candidateKey(resolved) : "";
    if (desiredRef.current !== desired) recoveryAttempts.current = 0;
    desiredRef.current = desired;
    const current = activeRef.current;

    if (!resolved) {
      if (current?.ready && preservesReadyArtwork) return;
      commit(null);
      return;
    }
    if (!current || current.candidate.logicalKey !== resolved.logicalKey) {
      commit({ candidate: resolved, ready: false });
      return;
    }
    if (current.candidate.contentKey === resolved.contentKey) return;

    let cancelled = false;
    void preloadArtwork(artwork)
      .then((candidate) => {
        if (
          cancelled ||
          !candidate ||
          desiredRef.current !== candidateKey(candidate)
        ) {
          return;
        }
        commit({ candidate, ready: true });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [artwork, commit, preservesReadyArtwork, resolved]);

  useEffect(() => {
    if (handledResumeVersion.current === resumeVersion) return;
    handledResumeVersion.current = resumeVersion;
    if (!artwork.src || !preservesReadyArtwork) return;
    const wasReady = Boolean(activeRef.current?.ready);
    if (wasReady && !shouldRefreshAfterResume(imageRef.current, loading)) {
      return;
    }
    recoveryAttempts.current = 0;

    let cancelled = false;
    void refreshArtworkCandidate(artwork)
      .then((candidate) => {
        if (!candidate || cancelled) return null;
        if (!wasReady) {
          commit({ candidate, ready: false });
          return null;
        }
        return preloadResolvedArtwork(candidate);
      })
      .then((candidate) => {
        if (
          cancelled ||
          !candidate ||
          desiredRef.current !== candidateKey(candidate)
        ) {
          return;
        }
        commit({ candidate, ready: true });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [artwork, commit, loading, preservesReadyArtwork, resumeVersion]);

  const displayed = useMemo(() => {
    if (!resolved) {
      return active?.ready && preservesReadyArtwork ? active : null;
    }
    if (!active || active.candidate.logicalKey !== resolved.logicalKey) {
      return { candidate: resolved, ready: false };
    }
    return active;
  }, [active, preservesReadyArtwork, resolved]);

  const recover = useCallback(
    (event: SyntheticEvent<HTMLImageElement, Event>) => {
      const reportTerminalFailure = () => {
        const current = activeRef.current;
        if (
          current?.ready &&
          current.candidate.logicalKey === artwork.logicalKey
        ) {
          commit({ ...current, ready: false });
        }
        onError?.(event);
      };
      const attempt = recoveryAttempts.current;
      const maxAttempts =
        artwork.retryPolicy === "eventual"
          ? EVENTUAL_RETRY_DELAYS_MS.length
          : 1;
      if (artwork.retryPolicy === "none" || attempt >= maxAttempts) {
        reportTerminalFailure();
        return;
      }

      const nextAttempt = attempt + 1;
      recoveryAttempts.current = nextAttempt;
      const recoveryDesired = desiredRef.current;
      const isCurrentRecovery = () =>
        mountedRef.current && desiredRef.current === recoveryDesired;
      const recovery = buildRecovery({
        artwork,
        attempt,
        nextAttempt,
      });

      void recovery
        .then((candidate) => {
          if (!isCurrentRecovery()) return undefined;
          if (!candidate) {
            reportTerminalFailure();
            return undefined;
          }
          if (!activeRef.current?.ready) {
            commit({ candidate, ready: false });
            return undefined;
          }
          return preloadResolvedArtwork(candidate);
        })
        .then((candidate) => {
          if (candidate && isCurrentRecovery()) {
            commit({ candidate, ready: true });
          }
        })
        .catch(() => {
          if (isCurrentRecovery()) reportTerminalFailure();
        });
    },
    [artwork, commit, onError],
  );

  const handleLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement, Event>) => {
      recoveryAttempts.current = 0;
      if (!displayed?.ready) {
        commit(displayed ? { ...displayed, ready: true } : null);
      }
      onLoad?.(event);
    },
    [commit, displayed, onLoad],
  );

  return { displayed, imageRef, onError: recover, onLoad: handleLoad };
}

function buildRecovery({
  artwork,
  attempt,
  nextAttempt,
}: {
  artwork: ArtworkSource;
  attempt: number;
  nextAttempt: number;
}): Promise<ResolvedArtworkCandidate | null> {
  if (artwork.retryPolicy === "credentials") {
    if (requiresMediaAccessTicket(artwork.src)) {
      return refreshArtworkCandidate(artwork);
    }
    const candidate = resolveArtworkCandidate(artwork);
    return Promise.resolve(
      candidate ? retryCandidate(candidate, nextAttempt) : null,
    );
  }

  return new Promise((resolve) => {
    window.setTimeout(() => {
      const candidate = resolveArtworkCandidate(artwork);
      resolve(candidate ? retryCandidate(candidate, nextAttempt) : null);
    }, EVENTUAL_RETRY_DELAYS_MS[attempt]);
  });
}

function candidateKey(candidate: ResolvedArtworkCandidate): string {
  return candidate.logicalKey + String.fromCharCode(0) + candidate.contentKey;
}

function createInitialActiveArtwork(
  candidate: ResolvedArtworkCandidate | null,
): ActiveArtwork | null {
  return candidate ? { candidate, ready: false } : null;
}

function activeArtworkReducer(
  _state: ActiveArtwork | null,
  action: { type: "replace"; value: ActiveArtwork | null },
): ActiveArtwork | null {
  return action.value;
}
