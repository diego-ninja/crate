import { useEffect, useState } from "react";

import type { Track } from "@/contexts/player-types";
import { api } from "@/lib/api";
import { artistPhotoApiUrl } from "@/lib/library-routes";

interface ResolvedArtistMeta {
  id: number;
  name: string;
  slug?: string;
  hasPhoto?: boolean;
}

function normalizeArtistName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

export function useResolvedPlayerArtist(currentTrack: Track | undefined, queue: Track[]) {
  const [artistPhotoFailed, setArtistPhotoFailed] = useState(false);
  const [resolvedArtist, setResolvedArtist] = useState<ResolvedArtistMeta | null>(null);

  const artistPhotoUrl = resolvedArtist?.id != null
    ? artistPhotoApiUrl({
        artistId: resolvedArtist.id,
        artistSlug: resolvedArtist.slug,
        artistName: resolvedArtist.name,
      })
    : null;

  const artistAvatarUrl = !artistPhotoFailed && artistPhotoUrl ? artistPhotoUrl : null;

  useEffect(() => {
    setArtistPhotoFailed(false);
  }, [artistPhotoUrl, currentTrack?.artistId]);

  useEffect(() => {
    if (!currentTrack?.artist) {
      setResolvedArtist(null);
      return;
    }

    const artistName = currentTrack.artist.trim();
    const normalizedArtist = normalizeArtistName(artistName);
    if (normalizedArtist.length < 2) {
      setResolvedArtist(null);
      return;
    }

    if (currentTrack.artistId != null) {
      setResolvedArtist({
        id: currentTrack.artistId,
        name: currentTrack.artist,
        slug: currentTrack.artistSlug,
      });
      return;
    }

    const queueMatch = queue.find((track) => {
      return track.artistId != null && normalizeArtistName(track.artist) === normalizedArtist;
    });
    if (queueMatch?.artistId != null) {
      setResolvedArtist({
        id: queueMatch.artistId,
        name: queueMatch.artist || artistName,
        slug: queueMatch.artistSlug,
      });
      return;
    }

    let cancelled = false;

    api<{ artists?: { id: number; name: string; slug?: string; has_photo?: boolean }[] }>(
      `/api/search?q=${encodeURIComponent(artistName)}&limit=5`,
    )
      .then((result) => {
        if (cancelled) return;
        const exactMatches = result.artists?.filter((artist) => normalizeArtistName(artist.name) === normalizedArtist) ?? [];
        const bestMatch = exactMatches.find((artist) => artist.has_photo) ?? exactMatches[0] ?? result.artists?.[0] ?? null;
        setResolvedArtist(
          bestMatch
            ? {
                id: bestMatch.id,
                name: bestMatch.name,
                slug: bestMatch.slug,
                hasPhoto: bestMatch.has_photo,
              }
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setResolvedArtist(null);
      });

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.artist, currentTrack?.artistId, currentTrack?.artistSlug, queue]);

  return {
    resolvedArtist,
    artistAvatarUrl,
    markArtistPhotoFailed: () => setArtistPhotoFailed(true),
  };
}
