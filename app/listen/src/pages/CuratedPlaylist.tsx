import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AlertCircle, ArrowLeft, ArrowDownToLine, CheckCircle2, Heart, Loader2, Play, Radio, Shuffle, Share2, Users } from "lucide-react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { useLazyPlaylistOptions } from "@/hooks/use-lazy-playlist-options";
import { api } from "@/lib/api";
import { TrackRow } from "@/components/cards/TrackRow";
import { OfflineBadge } from "@/components/offline/OfflineBadge";
import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { PlaylistTrackFilterBar, filterPlaylistTracks } from "@/components/playlists/PlaylistTrackFilterBar";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { isOfflineBusy } from "@/lib/offline";
import { fetchPlaylistRadio } from "@/lib/radio";
import { shuffleArray, formatTotalDuration } from "@/lib/utils";
import { albumCoverApiUrl } from "@/lib/library-routes";

interface CuratedPlaylistTrack {
  id: number;
  playlist_id: number;
  track_id?: number;
  track_storage_id?: string;
  track_path: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_slug?: string;
  duration: number;
  position: number;
  added_at: string;
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




export function CuratedPlaylist() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { playAll } = usePlayerActions();
  const { openCreatePlaylist } = usePlaylistComposer();
  const { supported: offlineSupported, getPlaylistState, getPlaylistRecord, togglePlaylistOffline } = useOffline();
  const { data, loading, refetch } = useApi<CuratedPlaylistData>(
    id ? `/api/curation/playlists/${id}` : null,
  );
  const { playlistOptions, ensurePlaylistOptionsLoaded } = useLazyPlaylistOptions();
  const [togglingFollow, setTogglingFollow] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const deferredFilterQuery = useDeferredValue(filterQuery);

  const playerTracks = useMemo(() => {
    if (!data?.tracks?.length) return [];
    return data.tracks.map(
      (t): Track => ({
        id: t.track_storage_id || t.track_path,
        storageId: t.track_storage_id,
        title: t.title || "Unknown",
        artist: t.artist || "",
        artistId: t.artist_id,
        artistSlug: t.artist_slug,
        album: t.album,
        albumId: t.album_id,
        albumSlug: t.album_slug,
        albumCover:
          t.artist && t.album
            ? albumCoverApiUrl({ albumId: t.album_id, albumSlug: t.album_slug, artistName: t.artist, albumName: t.album })
            : undefined,
        path: t.track_path,
        libraryTrackId: t.track_id,
      }),
    );
  }, [data]);

  const filteredTracks = useMemo(
    () => filterPlaylistTracks(data?.tracks || [], deferredFilterQuery),
    [data?.tracks, deferredFilterQuery],
  );

  function handlePlay() {
    if (playerTracks.length === 0) return;
    playAll(playerTracks, 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      href: data ? `/curation/playlists/${data.id}` : undefined,
      radio: data ? { seedType: "playlist", seedId: data.id } : undefined,
    });
  }

  function handlePlayTrack(trackEntryId: number) {
    if (!data || playerTracks.length === 0) return;
    const startIndex = data.tracks.findIndex((track) => track.id === trackEntryId);
    if (startIndex < 0) return;
    playAll(playerTracks, startIndex, {
      type: "playlist",
      name: data.name || "Playlist",
      href: `/curation/playlists/${data.id}`,
      radio: { seedType: "playlist", seedId: data.id },
    });
  }

  function handleShuffle() {
    if (playerTracks.length === 0) return;
    playAll(shuffleArray(playerTracks), 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      href: data ? `/curation/playlists/${data.id}` : undefined,
      radio: data ? { seedType: "playlist", seedId: data.id } : undefined,
    });
  }

  async function handlePlaylistRadio() {
    if (!data) return;
    try {
      const radio = await fetchPlaylistRadio({
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

  async function handleShare() {
    if (!data) return;
    const shareUrl = `${window.location.origin}/curation/playlist/${data.id}`;
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

  async function handleAddTrackToPlaylist(
    playlistId: number,
    track: { title: string; artist: string; album?: string; duration?: number; path?: string; libraryTrackId?: number },
  ) {
    if (!track.path && track.libraryTrackId == null) return;
    try {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", {
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
    album?: string;
    duration?: number;
    path?: string;
    library_track_id?: number;
  }) {
    openCreatePlaylist({
      tracks: track.path ? [{
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        path: track.path,
        libraryTrackId: track.library_track_id,
      }] : [],
    });
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

  const offlineState = getPlaylistState(data.id);
  const offlineRecord = getPlaylistRecord(data.id);
  const offlineBusy = isOfflineBusy(offlineState);
  const offlineProgress =
    offlineRecord?.trackCount
      ? `${Math.min(offlineRecord.readyTrackCount || 0, offlineRecord.trackCount)}/${offlineRecord.trackCount}`
      : null;
  const offlineButtonLabel =
    data.is_smart
      ? "Static only"
      : offlineState === "ready"
        ? "Available offline"
        : offlineState === "error"
          ? "Retry offline"
          : offlineState === "syncing"
            ? `Syncing...${offlineProgress ? ` ${offlineProgress}` : ""}`
            : offlineBusy
              ? `Downloading...${offlineProgress ? ` ${offlineProgress}` : ""}`
              : "Make available offline";
  const offlineStatusDetail =
    data.is_smart
      ? "Offline mirror is only available for static playlists."
      : offlineState === "ready"
        ? offlineRecord?.trackCount
          ? `${offlineRecord.trackCount} track${offlineRecord.trackCount === 1 ? "" : "s"} available offline`
          : "Available offline"
        : offlineBusy && offlineProgress
          ? `${offlineProgress} tracks saved for offline`
          : offlineState === "error"
            ? offlineRecord?.readyTrackCount
              ? `${offlineRecord.readyTrackCount}/${offlineRecord.trackCount} tracks saved. Retry to finish the offline copy.`
              : "Offline copy failed. Retry to finish the playlist mirror."
            : null;

  async function handleToggleOffline() {
    if (!data) return;
    try {
      const result = await togglePlaylistOffline({
        playlistId: data.id,
        title: data.name,
        isSmart: data.is_smart,
      });
      toast.success(result === "removed" ? "Offline copy removed" : "Playlist available offline");
    } catch (error) {
      toast.error((error as Error).message || "Failed to update offline copy");
    }
  }

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
            showCrateMark
            crateMarkClassName="right-3.5 top-3.5 [&_img]:h-4.5 [&_img]:w-4.5"
            className="aspect-square rounded-3xl shadow-2xl"
          />
        </div>

        <div className="flex flex-col justify-end gap-3 text-left">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold text-foreground">{data.name}</h1>
              <OfflineBadge state={offlineState} />
            </div>
            {data.description ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{data.description}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{data.track_count} tracks</span>
            {data.total_duration > 0 ? <span>{formatTotalDuration(data.total_duration)}</span> : null}
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
          disabled={playerTracks.length === 0}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Play size={16} fill="currentColor" />
          Play
        </button>
        <button
          onClick={handleShuffle}
          disabled={playerTracks.length === 0}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-sm text-foreground hover:bg-white/5 transition-colors disabled:opacity-50"
        >
          <Shuffle size={15} />
          Shuffle
        </button>
        <button
          onClick={handlePlaylistRadio}
          disabled={playerTracks.length === 0}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-sm text-foreground hover:bg-white/5 transition-colors disabled:opacity-50"
        >
          <Radio size={15} />
          Playlist Radio
        </button>
        <button
          onClick={handleToggleOffline}
          disabled={!offlineSupported || data.is_smart || offlineBusy}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-full border text-sm transition-colors disabled:opacity-50 ${
            offlineState === "ready"
              ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-200"
              : offlineBusy
                ? "border border-primary/25 bg-primary/10 text-primary"
                : offlineState === "error"
                  ? "border border-amber-400/25 bg-amber-400/10 text-amber-200"
                  : "border-white/15 text-foreground hover:bg-white/5"
          }`}
          aria-label={offlineState === "ready" ? "Remove offline copy" : "Make available offline"}
          title={offlineButtonLabel}
        >
          {offlineState === "ready" ? (
            <CheckCircle2 size={15} />
          ) : offlineBusy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : offlineState === "error" ? (
            <AlertCircle size={15} />
          ) : (
            <ArrowDownToLine size={15} />
          )}
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
        <button
          onClick={handleShare}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-sm text-foreground hover:bg-white/5 transition-colors"
        >
          <Share2 size={15} />
          Share
        </button>
      </div>

      {offlineStatusDetail ? (
        <p className="text-xs text-muted-foreground">
          {offlineStatusDetail}
        </p>
      ) : null}

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
          {filteredTracks.map((track, index) => (
            <TrackRow
              key={track.id}
              track={{
                id: track.track_storage_id ?? track.track_id ?? track.track_path,
                storage_id: track.track_storage_id,
                title: track.title || "Unknown",
                artist: track.artist || "",
                artist_id: track.artist_id,
                artist_slug: track.artist_slug,
                album: track.album,
                album_id: track.album_id,
                album_slug: track.album_slug,
                duration: track.duration,
                path: track.track_path,
                library_track_id: track.track_id,
              }}
              index={index + 1}
              showArtist
              showAlbum
              playlistOptions={playlistOptions}
              onAddToPlaylist={handleAddTrackToPlaylist}
              onCreatePlaylist={handleCreatePlaylistFromTrack}
              onActionMenuOpen={ensurePlaylistOptionsLoaded}
              onPlayOverride={() => handlePlayTrack(track.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
