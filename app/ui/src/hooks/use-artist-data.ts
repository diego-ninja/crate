import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { artistActionApiPath } from "@/lib/library-routes";

interface EnrichmentData {
  lastfm?: {
    bio?: string;
    tags?: string[];
    similar?: { id?: number; slug?: string; name: string }[];
    listeners?: number;
    playcount?: number;
    url?: string;
  };
  spotify?: {
    popularity?: number;
    followers?: number;
    genres?: string[];
    top_tracks?: {
      name: string;
      album: string;
      duration_ms: number;
      popularity: number;
      preview_url?: string;
    }[];
    related_artists?: {
      id?: number;
      slug?: string;
      name: string;
      images?: { url: string }[];
      genres?: string[];
      popularity?: number;
    }[];
    url?: string;
  };
  setlist?: {
    probable_setlist?: {
      title: string;
      frequency: number;
      play_count: number;
      last_played?: string;
    }[];
    total_shows?: number;
    last_show?: { date: string; venue: string; city: string };
  };
  musicbrainz?: {
    mbid?: string;
    type?: string;
    country?: string;
    area?: string;
    begin_date?: string;
    end_date?: string;
    members?: {
      name: string;
      type?: string;
      begin?: string;
      end?: string | null;
      attributes?: string[];
    }[];
    urls?: Record<string, string>;
  };
  fanart?: {
    backgrounds?: string[];
    thumbs?: string[];
    logos?: string[];
    banners?: string[];
  };
}

interface TopTrack {
  id: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_slug?: string;
  duration: number;
  track: number;
  listeners?: number;
}

export function useArtistEnrichment(artistId: number | undefined, artistEntityUid?: string) {
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const endpoint = artistActionApiPath({ artistId, artistEntityUid }, "enrichment");
    if (!endpoint) return;
    let cancelled = false;
    setLoading(true);
    api<EnrichmentData>(endpoint)
      .then((d) => { if (!cancelled) setEnrichment(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [artistEntityUid, artistId]);

  return { enrichment, loading };
}

export function useTopTracks(artistId: number | undefined, artistEntityUid?: string) {
  const [tracks, setTracks] = useState<TopTrack[]>([]);

  useEffect(() => {
    const endpoint = artistActionApiPath({ artistId, artistEntityUid }, "top-tracks?count=10");
    if (!endpoint) return;
    let cancelled = false;
    api<TopTrack[]>(endpoint)
      .then((d) => { if (!cancelled && Array.isArray(d)) setTracks(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [artistEntityUid, artistId]);

  return tracks;
}

export type { EnrichmentData, TopTrack };
