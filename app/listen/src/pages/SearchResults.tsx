import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import { Loader2, Play } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { toTrackRowData } from "@/lib/track-row-data";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { TrackRow } from "@/components/cards/TrackRow";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";

interface SearchData {
  artists: { id?: number; entity_uid?: string; slug?: string; name: string }[];
  albums: {
    artist: string;
    artist_id?: number;
    artist_entity_uid?: string;
    artist_slug?: string;
    name: string;
    id?: number;
    entity_uid?: string;
    slug?: string;
    year?: string;
  }[];
  tracks: {
    id?: number;
    entity_uid?: string;
    slug?: string;
    title: string;
    artist: string;
    artist_id?: number;
    artist_entity_uid?: string;
    artist_slug?: string;
    album: string;
    album_id?: number;
    album_entity_uid?: string;
    album_slug?: string;
    path?: string;
    duration?: number;
  }[];
}

export function SearchResults() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const [data, setData] = useState<SearchData | null>(null);
  const [loading, setLoading] = useState(false);
  const { playAll } = usePlayerActions();

  useEffect(() => {
    if (!query.trim()) { setData(null); return; }
    const controller = new AbortController();
    setLoading(true);
    api<SearchData>(`/api/search?q=${encodeURIComponent(query)}&limit=50`, "GET", undefined, { signal: controller.signal })
      .then(setData)
      .catch((e) => { if (!(e instanceof ApiError)) return; setData({ artists: [], albums: [], tracks: [] }); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query]);

  const trackRowData = useMemo(() =>
    (data?.tracks ?? []).map((t, i) => toTrackRowData({
      ...t,
      id: t.id ?? t.path ?? `${t.artist}-${t.title}-${i}`,
      library_track_id: typeof t.id === "number" ? t.id : undefined,
    })),
    [data?.tracks],
  );

  if (!query) return <p className="text-muted-foreground">Enter a search term</p>;
  if (loading && !data) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (!data) return null;

  const trackToPlayer = (t: SearchData["tracks"][0]): Track =>
    toPlayableTrack({
      ...t,
      library_track_id: typeof t.id === "number" ? t.id : undefined,
    }, {
      cover: t.album
        ? albumCoverApiUrl({
            albumId: t.album_id,
            albumEntityUid: t.album_entity_uid,
            artistEntityUid: t.artist_entity_uid,
            albumSlug: t.album_slug,
            artistName: t.artist,
            albumName: t.album,
          })
        : undefined,
    });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Results for "{query}"</h1>

      {data.artists.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Artists ({data.artists.length})</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            {data.artists.map((a) => (
              <ArtistCard
                key={a.id || a.entity_uid || a.name}
                name={a.name}
                artistId={a.id}
                artistEntityUid={a.entity_uid}
                artistSlug={a.slug}
                layout="grid"
              />
            ))}
          </div>
        </section>
      )}

      {data.albums.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Albums ({data.albums.length})</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {data.albums.map((a) => (
              <AlbumCard
                layout="grid"
                key={a.id || a.entity_uid || `${a.artist}-${a.name}`}
                artist={a.artist}
                album={a.name}
                albumId={a.id}
                albumEntityUid={a.entity_uid}
                artistEntityUid={a.artist_entity_uid}
                albumSlug={a.slug}
                year={a.year}
                cover={albumCoverApiUrl({
                  albumId: a.id,
                  albumEntityUid: a.entity_uid,
                  artistEntityUid: a.artist_entity_uid,
                  albumSlug: a.slug,
                  artistName: a.artist,
                  albumName: a.name,
                })}
              />
            ))}
          </div>
        </section>
      )}

      {data.tracks.length > 0 && (
        <section>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-lg font-semibold">Tracks ({data.tracks.length})</h2>
            <button
              onClick={() => playAll(data.tracks.map(trackToPlayer), 0, { type: "queue", name: `Search: ${query}` })}
              className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white"
            >
              <Play size={12} fill="currentColor" /> Play all
            </button>
          </div>
          <div>
            {trackRowData.map((t, i) => (
              <TrackRow
                key={t.id || t.path || `${t.artist}-${t.title}-${i}`}
                track={t}
                index={i}
                showArtist
                showAlbum
                queueTracks={trackRowData}
              />
            ))}
          </div>
        </section>
      )}

      {data.artists.length === 0 && data.albums.length === 0 && data.tracks.length === 0 && (
        <p className="text-muted-foreground text-center py-12">No results found for "{query}"</p>
      )}
    </div>
  );
}
