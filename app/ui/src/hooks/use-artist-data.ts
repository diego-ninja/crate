import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";

interface EnrichmentData {
  lastfm?: {
    bio?: string;
    tags?: string[];
    similar?: { name: string }[];
    listeners?: number;
  };
  spotify?: {
    popularity?: number;
    followers?: number;
    genres?: string[];
    related_artists?: { name: string; images?: { url: string }[] }[];
  };
  setlist?: {
    probable_setlist?: { title: string; frequency: number; play_count: number }[];
  };
  musicbrainz?: {
    mbid?: string;
    type?: string;
    country?: string;
    area?: string;
    begin_date?: string;
    end_date?: string;
    members?: { name: string; type?: string; begin?: string; end?: string }[];
    urls?: Record<string, string>;
  };
  fanart?: {
    logos?: string[];
    banners?: string[];
  };
}

interface NavidromeArtistLink {
  id: string;
  name: string;
  navidrome_url: string;
}

interface TopTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  track: number;
}

export function useArtistEnrichment(name: string | undefined) {
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    setLoading(true);
    api<EnrichmentData>(`/api/artist/${encPath(name)}/enrichment`)
      .then((d) => { if (!cancelled) setEnrichment(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [name]);

  return { enrichment, loading };
}

export function useNavidromeLink(artist: string | undefined, album?: string) {
  const [data, setData] = useState<NavidromeArtistLink | null>(null);

  useEffect(() => {
    if (!artist) return;
    let cancelled = false;
    const url = album
      ? `/api/navidrome/album/${encPath(artist)}/${encPath(album)}/link`
      : `/api/navidrome/artist/${encPath(artist)}/link`;
    api<NavidromeArtistLink>(url)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [artist, album]);

  return data;
}

export function useTopTracks(name: string | undefined) {
  const [tracks, setTracks] = useState<TopTrack[]>([]);

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    api<TopTrack[]>(`/api/navidrome/artist/${encPath(name)}/top-tracks?count=10`)
      .then((d) => { if (!cancelled && Array.isArray(d)) setTracks(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [name]);

  return tracks;
}

export type { EnrichmentData, NavidromeArtistLink, TopTrack };
