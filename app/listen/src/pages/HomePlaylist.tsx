import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Loader2, Play, Radio, Share2, Shuffle, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { CoreTracksArtwork } from "@/components/home/CoreTracksArtwork";
import { MixArtwork } from "@/components/home/MixArtwork";
import type { HomeGeneratedPlaylistDetail } from "@/components/home/home-model";
import { PlaylistArtwork } from "@/components/playlists/PlaylistArtwork";
import { PlaylistTrackFilterBar, filterPlaylistTracks } from "@/components/playlists/PlaylistTrackFilterBar";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { fetchHomePlaylistRadio } from "@/lib/radio";
import { formatTotalDuration, shuffleArray } from "@/lib/utils";

export function HomePlaylist() {
  const navigate = useNavigate();
  const { playlistId } = useParams<{ playlistId: string }>();
  const { playAll } = usePlayerActions();
  const { openCreatePlaylist } = usePlaylistComposer();
  const [filterQuery, setFilterQuery] = useState("");
  const deferredFilterQuery = useDeferredValue(filterQuery);
  const { data, loading } = useApi<HomeGeneratedPlaylistDetail>(
    playlistId ? `/api/me/home/playlists/${encodeURIComponent(playlistId)}` : null,
  );
  const { data: playlistOptions } = useApi<Array<{ id: number; name: string }>>("/api/playlists");

  const playerTracks = useMemo(() => {
    if (!data?.tracks?.length) return [];
    return data.tracks.map(
      (track): Track => ({
        id: track.track_storage_id || track.track_path || String(track.track_id || `${track.artist}-${track.title}`),
        storageId: track.track_storage_id || undefined,
        title: track.title || "Unknown",
        artist: track.artist || "",
        artistId: track.artist_id || undefined,
        artistSlug: track.artist_slug || undefined,
        album: track.album || undefined,
        albumId: track.album_id || undefined,
        albumSlug: track.album_slug || undefined,
        albumCover:
          track.artist && track.album
            ? albumCoverApiUrl({
                albumId: track.album_id || undefined,
                albumSlug: track.album_slug || undefined,
                artistName: track.artist,
                albumName: track.album,
              }) || undefined
            : undefined,
        path: track.track_path || undefined,
        libraryTrackId: track.track_id || undefined,
      }),
    );
  }, [data]);

  const filteredTracks = useMemo(
    () => filterPlaylistTracks(data?.tracks || [], deferredFilterQuery),
    [data?.tracks, deferredFilterQuery],
  );

  const trackRows = useMemo<TrackRowData[]>(() =>
    filteredTracks.map((track) => ({
      id: track.track_storage_id ?? track.track_id ?? track.track_path ?? track.title,
      storage_id: track.track_storage_id ?? undefined,
      title: track.title,
      artist: track.artist,
      artist_id: track.artist_id ?? undefined,
      artist_slug: track.artist_slug ?? undefined,
      album: track.album ?? undefined,
      album_id: track.album_id ?? undefined,
      album_slug: track.album_slug ?? undefined,
      duration: track.duration ?? undefined,
      path: track.track_path ?? undefined,
      library_track_id: track.track_id ?? undefined,
    })),
    [filteredTracks],
  );

  function handlePlay() {
    if (!data || !playerTracks.length) return;
    playAll(playerTracks, 0, {
      type: "playlist",
      name: data.name,
      id: data.id,
    });
  }

  function handleShuffle() {
    if (!data || !playerTracks.length) return;
    playAll(shuffleArray(playerTracks), 0, {
      type: "playlist",
      name: data.name,
      id: data.id,
    });
  }

  async function handleShare() {
    if (!data) return;
    const shareUrl = `${window.location.origin}/home/playlist/${encodeURIComponent(data.id)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: data.name, text: data.name, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Playlist link copied");
      }
    } catch {
      toast.error("Failed to share playlist");
    }
  }

  async function handleRadio() {
    if (!data) return;
    try {
      const radio = await fetchHomePlaylistRadio({
        playlistId: data.id,
        playlistName: data.name,
      });
      if (!radio.tracks.length) {
        toast.info("Playlist radio is not available yet");
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error("Failed to start playlist radio");
    }
  }

  async function handleAddTrackToPlaylist(
    targetPlaylistId: number,
    track: { title: string; artist: string; album?: string; duration?: number; path?: string; libraryTrackId?: number },
  ) {
    if (!track.path && track.libraryTrackId == null) return;
    try {
      await api(`/api/playlists/${targetPlaylistId}/tracks`, "POST", {
        tracks: [{
          track_id: track.libraryTrackId,
          path: track.path,
          title: track.title,
          artist: track.artist,
          album: track.album || "",
          duration: track.duration || 0,
        }],
      });
      toast.success("Track added to playlist");
    } catch {
      toast.error("Failed to add track to playlist");
    }
  }

  function handleCreatePlaylistFromTrack(track: {
    title: string;
    artist: string;
    album?: string | null;
    duration?: number | null;
    path?: string | null;
    track_id?: number | null;
  }) {
    openCreatePlaylist({
      tracks: track.path ? [{
        title: track.title,
        artist: track.artist,
        album: track.album || undefined,
        duration: track.duration || undefined,
        path: track.path,
        libraryTrackId: track.track_id || undefined,
      }] : [],
    });
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

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      <div className="flex flex-col gap-6 md:flex-row">
        <div className="w-[220px] max-w-full shrink-0">
          {data.kind === "core" ? (
            <CoreTracksArtwork
              item={data}
              className="aspect-square rounded-3xl shadow-2xl"
            />
          ) : data.kind === "mix" ? (
            <MixArtwork
              item={data}
              className="aspect-square rounded-3xl shadow-2xl"
            />
          ) : (
            <PlaylistArtwork
              name={data.name}
              tracks={data.artwork_tracks}
              className="aspect-square rounded-3xl shadow-2xl"
            />
          )}
        </div>

        <div className="flex flex-col justify-end gap-3 text-left">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-primary">
            <Sparkles size={12} />
            {data.badge}
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">{data.name}</h1>
            {data.description ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{data.description}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{data.track_count} tracks</span>
            {data.total_duration > 0 ? <span>{formatTotalDuration(data.total_duration)}</span> : null}
            <span>Generated for you</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handlePlay}
          disabled={playerTracks.length === 0}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <Play size={16} fill="currentColor" />
          Play
        </button>
        <button
          onClick={handleShuffle}
          disabled={playerTracks.length === 0}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-white/5 disabled:opacity-50"
        >
          <Shuffle size={15} />
          Shuffle
        </button>
        <button
          onClick={handleShare}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-white/5"
        >
          <Share2 size={15} />
          Share
        </button>
        <button
          onClick={handleRadio}
          disabled={playerTracks.length === 0}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-white/5 disabled:opacity-50"
        >
          <Radio size={15} />
          Playlist Radio
        </button>
      </div>

      <PlaylistTrackFilterBar
        query={filterQuery}
        onQueryChange={setFilterQuery}
        totalCount={data.tracks.length}
        filteredCount={filteredTracks.length}
      />

      {data.tracks.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-muted-foreground">This playlist has no tracks yet</p>
        </div>
      ) : filteredTracks.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-muted-foreground">No tracks match this filter</p>
        </div>
      ) : (
        <div className="space-y-1">
          {trackRows.map((row, index) => (
            <TrackRow
              key={row.storage_id ?? row.id ?? `${row.path}-${index}`}
              track={row}
              index={index + 1}
              showArtist
              showAlbum
              playlistOptions={(playlistOptions || []).map((playlist) => ({ id: playlist.id, name: playlist.name }))}
              onAddToPlaylist={handleAddTrackToPlaylist}
              onCreatePlaylist={handleCreatePlaylistFromTrack}
              queueTracks={trackRows}
            />
          ))}
        </div>
      )}
    </div>
  );
}
