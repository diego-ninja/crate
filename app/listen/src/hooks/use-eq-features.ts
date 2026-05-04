import { useEffect, useState } from "react";

import type { Track } from "@/contexts/player-types";
import { api } from "@/lib/api";
import { trackEqFeaturesApiPath } from "@/lib/library-routes";

/**
 * EQ-relevant audio features persisted by the analysis pipeline. All
 * fields are nullable because analysis hasn't necessarily finished for
 * every track — callers treat missing values as "no signal, stay flat".
 */
export interface EqFeatures {
  energy: number | null;
  loudness: number | null;          // LUFS, roughly -30..-6
  dynamicRange: number | null;      // dB crest-like
  brightness: number | null;        // normalized spectral centroid, 0..1
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
}

export type EqFeaturesState =
  | { status: "idle" }          // No track, or no hook consumer (adaptive off).
  | { status: "loading" }       // Fetch in flight.
  | { status: "ready"; features: EqFeatures }
  | { status: "unavailable" };  // 404, backend error, or track has no persisted ID.

// In-memory cache so scrubbing through a playlist doesn't hit the API
// again for tracks we've already seen in this session. Keyed by endpoint
// so id- and storage-based lookups don't collide. We cache the fully
// resolved state (including "unavailable") so a track without analysis
// doesn't re-fetch on every track change.
const cache = new Map<string, EqFeaturesState>();

function endpointFor(track: Track): string | null {
  return trackEqFeaturesApiPath(track) || null;
}

/**
 * Fetches EQ features for the given track. Returns a tagged state so
 * the UI can distinguish "loading" from "no data" instead of showing
 * an indefinite loading spinner for tracks that simply don't have
 * analysis yet.
 */
export function useEqFeatures(track: Track | undefined): EqFeaturesState {
  const [state, setState] = useState<EqFeaturesState>({ status: "idle" });

  useEffect(() => {
    const endpoint = track ? endpointFor(track) : null;

    if (!track) {
      setState({ status: "idle" });
      return;
    }
    if (!endpoint) {
      // Track has no persistable id — we can't look up features for it
      // (e.g. a hand-crafted Track from some ad-hoc flow). Don't hang
      // in loading; surface as unavailable immediately.
      setState({ status: "unavailable" });
      return;
    }

    const cached = cache.get(endpoint);
    if (cached) {
      setState(cached);
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    api<EqFeatures>(endpoint)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          const next: EqFeaturesState = { status: "unavailable" };
          cache.set(endpoint, next);
          setState(next);
          return;
        }
        const next: EqFeaturesState = { status: "ready", features: data };
        cache.set(endpoint, next);
        setState(next);
      })
      .catch(() => {
        if (cancelled) return;
        // 404 (track exists but no analysis row), or network/auth
        // failure — either way, adaptive has no signal to act on.
        // Cache so we don't spam the endpoint on repeat visits.
        const next: EqFeaturesState = { status: "unavailable" };
        cache.set(endpoint, next);
        setState(next);
      });

    return () => { cancelled = true; };
  }, [track, track?.id, track?.entityUid, track?.libraryTrackId]);

  return state;
}
