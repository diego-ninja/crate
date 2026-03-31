import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Heart, Loader2, Play, Shuffle, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { TrackRow } from "@/components/cards/TrackRow";
import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { encPath } from "@/lib/utils";

interface CuratedPlaylistTrack {
  id: number;
  playlist_id: number;
  track_id?: number;
  track_path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  added_at: string;
  navidrome_id?: string;
}

interface CuratedPlaylistData {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  is_smart: boolean;
  is_curated: boolean;
  category?: string | null;
  track_count: number;
  total_duration: number;
  artwork_tracks?: PlaylistArtworkTrack[];
  follower_count: number;
  is_followed: boolean;
  tracks: CuratedPlaylistTrack[];
}

function fmtTotalDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

export function CuratedPlaylist() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { playAll } = usePlayerActions();
  const { data, loading, refetch } = useApi<CuratedPlaylistData>(
    id ? `/api/curation/playlists/${id}` : null,
  );
  const [togglingFollow, setTogglingFollow] = useState(false);

  const playerTracks = useMemo(() => {
    if (!data?.tracks?.length) return [];
    return data.tracks.map(
      (t): Track => ({
        id: t.track_path,
        title: t.title || "Unknown",
        artist: t.artist || "",
        album: t.album,
        albumCover:
          t.artist && t.album
            ? `/api/cover/${encPath(t.artist)}/${encPath(t.album)}`
            : undefined,
        path: t.track_path,
        navidromeId: t.navidrome_id,
        libraryTrackId: t.track_id,
      }),
    );
  }, [data]);

  function handlePlay() {
    if (playerTracks.length === 0) return;
    playAll(playerTracks, 0, { type: "playlist", name: data?.name || "Playlist" });
  }

  function handleShuffle() {
    if (playerTracks.length === 0) return;
    playAll(shuffleArray(playerTracks), 0, { type: "playlist", name: data?.name || "Playlist" });
  }

  async function handleToggleFollow() {
    if (!id || !data) return;
    setTogglingFollow(true);
    try {
      if (data.is_followed) {
        await api(`/api/curation/playlists/${id}/follow`, "DELETE");
        toast.success("Removed from your library");
      } else {
        await api(`/api/curation/playlists/${id}/follow`, "POST");
        toast.success("Added to your library");
      }
      refetch();
    } catch {
      toast.error("Failed to update playlist");
    } finally {
      setTogglingFollow(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">Playlist not found</p>
      </div>
    );
  }

  const badgeLabel = data.is_curated ? "Curated Playlist" : data.is_smart ? "Smart Playlist" : "System Playlist";

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      <div className="flex flex-col gap-6 md:flex-row">
        <div className="w-[220px] max-w-full shrink-0">
          <PlaylistArtwork
            name={data.name}
            coverDataUrl={data.cover_data_url}
            tracks={data.artwork_tracks}
            className="aspect-square rounded-3xl shadow-2xl"
          />
        </div>

        <div className="flex flex-col justify-end gap-3 text-left">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-primary">
            <Sparkles size={12} />
            {badgeLabel}
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">{data.name}</h1>
            {data.description ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{data.description}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{data.track_count} tracks</span>
            {data.total_duration > 0 ? <span>{fmtTotalDuration(data.total_duration)}</span> : null}
            <span className="inline-flex items-center gap-1">
              <Users size={12} />
              {data.follower_count} follower{data.follower_count !== 1 ? "s" : ""}
            </span>
            {data.category ? <span>{data.category}</span> : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handlePlay}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Play size={16} fill="currentColor" />
          Play
        </button>
        <button
          onClick={handleShuffle}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-sm text-foreground hover:bg-white/5 transition-colors"
        >
          <Shuffle size={15} />
          Shuffle
        </button>
        <button
          onClick={handleToggleFollow}
          disabled={togglingFollow}
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm transition-colors ${
            data.is_followed
              ? "border-primary/30 bg-primary/15 text-primary"
              : "border-white/15 text-foreground hover:bg-white/5"
          }`}
        >
          {togglingFollow ? <Loader2 size={15} className="animate-spin" /> : <Heart size={15} className={data.is_followed ? "fill-current" : ""} />}
          {data.is_followed ? "Following" : "Follow"}
        </button>
      </div>

      <div className="space-y-1">
        {data.tracks.map((track, index) => (
          <TrackRow
            key={track.id}
            track={{
              id: track.track_id ?? track.track_path,
              title: track.title || "Unknown",
              artist: track.artist || "",
              album: track.album,
              duration: track.duration,
              path: track.track_path,
              navidrome_id: track.navidrome_id,
              library_track_id: track.track_id,
            }}
            index={index + 1}
            showArtist
            showAlbum
          />
        ))}
      </div>
    </div>
  );
}
