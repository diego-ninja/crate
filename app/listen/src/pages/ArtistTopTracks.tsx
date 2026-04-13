import { ArrowLeft, Play } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { TrackRow } from "@/components/cards/TrackRow";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { albumCoverApiUrl, artistApiPath, artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

interface ArtistTopTrack {
  id: string;
  artist_id?: number;
  artist_slug?: string;
  album_id?: number;
  album_slug?: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  track: number;
}

function toPlayerTracks(tracks: ArtistTopTrack[]): Track[] {
  return tracks.map((track) => ({
    id: track.id,
    title: track.title || "Unknown",
    artist: track.artist,
    artistId: track.artist_id,
    artistSlug: track.artist_slug,
    album: track.album,
    albumId: track.album_id,
    albumSlug: track.album_slug,
    albumCover: track.artist && track.album
      ? albumCoverApiUrl({ albumId: track.album_id, albumSlug: track.album_slug, artistName: track.artist, albumName: track.album })
      : artistPhotoApiUrl({ artistId: track.artist_id, artistSlug: track.artist_slug, artistName: track.artist }),
    path: track.id.includes("/") ? track.id : undefined,
  }));
}

export function ArtistTopTracks() {
  const navigate = useNavigate();
  const { artistId: artistIdParam } = useParams<{ artistId?: string }>();
  const artistId = artistIdParam ? Number(artistIdParam) : undefined;
  const { playAll } = usePlayerActions();
  const { data: artist } = useApi<{ id?: number; slug?: string; name: string }>(
    artistId != null ? artistApiPath({ artistId }) : null,
  );
  const artistName = artist?.name || "";
  const { data: topTracks, loading } = useApi<ArtistTopTrack[]>(
    artistId != null ? `/api/artists/${artistId}/top-tracks?count=50` : null,
  );

  function handlePlayAll() {
    const queue = toPlayerTracks(topTracks || []);
    if (!queue.length) {
      toast.info("No top tracks available for this artist yet");
      return;
    }
    playAll(queue, 0, { type: "queue", name: `${artistName} Top Tracks` });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-16">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(artistPagePath({ artistId: artist?.id ?? artistId, artistSlug: artist?.slug }))}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white/70 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{artistName}</h1>
            <p className="text-sm text-muted-foreground">Top Tracks</p>
          </div>
        </div>

        <button
          className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          onClick={handlePlayAll}
        >
          <Play size={15} fill="currentColor" />
          Play
        </button>
      </div>

      <div className="rounded-xl border border-white/5 bg-white/[0.02]">
        {(topTracks || []).map((track, index) => (
          <TrackRow
            key={`${track.id}-${index}`}
            track={{
              id: track.id,
              title: track.title,
              artist: track.artist,
              artist_id: track.artist_id,
              artist_slug: track.artist_slug,
              album: track.album,
              album_id: track.album_id,
              album_slug: track.album_slug,
              duration: track.duration,
              path: track.id.includes("/") ? track.id : undefined,
            }}
            index={track.track || index + 1}
            showAlbum
            albumCover={track.artist && track.album
              ? albumCoverApiUrl({ albumId: track.album_id, albumSlug: track.album_slug, artistName: track.artist, albumName: track.album })
              : artistPhotoApiUrl({ artistId: track.artist_id, artistSlug: track.artist_slug, artistName: track.artist })}
            showCoverThumb
          />
        ))}
      </div>
    </div>
  );
}
