import { useEffect, useState } from "react";

import type { Track } from "@/contexts/player-types";
import { api } from "@/lib/api";
import { trackGenreApiPath } from "@/lib/library-routes";

/**
 * Shape returned by the track genre endpoints (`/api/tracks/.../genre`).
 * `primary.canonical = false` means the slug is a raw tag
 * that couldn't be resolved against the genre taxonomy — the UI should
 * still display it, but preset lookup should be skipped.
 *
 * `preset` is resolved server-side via the taxonomy's eq_gains column
 * with parent-BFS inheritance. `source === "inherited"` means the
 * gains were borrowed from an ancestor, identified by `inheritedFrom`.
 * `preset === null` means nothing was found on the inheritance chain —
 * the UI should hold flat.
 */
export interface TrackGenrePreset {
  gains: number[];
  source: "direct" | "inherited";
  inheritedFrom: { slug: string; name: string } | null;
}

export interface TrackGenre {
  primary: { slug: string; name: string; canonical: boolean } | null;
  topLevel: { slug: string; name: string } | null;
  source: "album" | "artist" | null;
  preset: TrackGenrePreset | null;
}

export type TrackGenreState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; genre: TrackGenre }
  | { status: "unavailable" };

// In-memory cache shared across hook instances / track changes so we
// don't re-hit the endpoint on the same track repeatedly (e.g. toggling
// adaptive modes). Keyed by endpoint URL so id- and storage-based
// lookups don't collide.
const cache = new Map<string, TrackGenreState>();

function endpointFor(track: Track): string | null {
  return trackGenreApiPath(track) || null;
}

/**
 * Fetch the primary genre for a track. Returns a tagged state so the
 * UI can distinguish "no genre yet" (loading) from "no analysis/tags"
 * (unavailable).
 *
 * Only fetches when `track` is defined — the caller is expected to
 * pass `undefined` when genre-adaptive mode is off.
 */
export function useTrackGenre(track: Track | undefined): TrackGenreState {
  const [state, setState] = useState<TrackGenreState>({ status: "idle" });

  useEffect(() => {
    const endpoint = track ? endpointFor(track) : null;

    if (!track) {
      setState({ status: "idle" });
      return;
    }
    if (!endpoint) {
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

    api<TrackGenre>(endpoint)
      .then((data) => {
        if (cancelled) return;
        if (!data || !data.primary) {
          const next: TrackGenreState = { status: "unavailable" };
          cache.set(endpoint, next);
          setState(next);
          return;
        }
        const next: TrackGenreState = { status: "ready", genre: data };
        cache.set(endpoint, next);
        setState(next);
      })
      .catch(() => {
        if (cancelled) return;
        const next: TrackGenreState = { status: "unavailable" };
        cache.set(endpoint, next);
        setState(next);
      });

    return () => { cancelled = true; };
  }, [track, track?.id, track?.entityUid, track?.libraryTrackId]);

  return state;
}
