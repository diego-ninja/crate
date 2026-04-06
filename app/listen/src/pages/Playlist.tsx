import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Play, Shuffle, Loader2, Sparkles, RefreshCw, Pencil, Trash2, Share2, Radio } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { TrackRow } from "@/components/cards/TrackRow";
import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import {
  PlaylistCreateModal,
  type PlaylistComposerTrack,
} from "@/components/playlists/PlaylistCreateModal";
import { AppModal, ModalBody, ModalFooter, ModalHeader, ModalCloseButton } from "@/components/ui/AppModal";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { fetchPlaylistRadio } from "@/lib/radio";
import { shuffleArray, formatTotalDuration } from "@/lib/utils";
import { albumCoverApiUrl } from "@/lib/library-routes";

interface PlaylistTrack {
  id: number;
  playlist_id: number;
  track_id?: number;
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
  navidrome_id?: string;
}

interface PlaylistData {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  user_id: number;
  is_smart: boolean;
  smart_rules?: unknown;
  track_count: number;
  total_duration: number;
  created_at: string;
  updated_at: string;
  artwork_tracks?: PlaylistArtworkTrack[];
  tracks: PlaylistTrack[];
}




export function Playlist() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { data, loading, refetch } = useApi<PlaylistData>(
    id ? `/api/playlists/${id}` : null,
  );
  const { data: playlistOptions } = useApi<Array<{ id: number; name: string }>>("/api/playlists");
  const { playAll } = usePlayerActions();
  const { openCreatePlaylist } = usePlaylistComposer();
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const playerTracks = useMemo(() => {
    if (!data?.tracks?.length) return [];
    return data.tracks.map(
      (t): Track => ({
        id: t.track_path,
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
        navidromeId: t.navidrome_id,
        libraryTrackId: t.track_id,
      }),
    );
  }, [data]);

  const editableTracks = useMemo<PlaylistComposerTrack[]>(() => {
    if (!data?.tracks?.length) return [];
    return data.tracks.map((track) => ({
      title: track.title || "Unknown",
      artist: track.artist || "",
      album: track.album,
      duration: track.duration,
      path: track.track_path,
      libraryTrackId: track.track_id,
      navidromeId: track.navidrome_id,
      playlistEntryId: track.id,
      playlistPosition: track.position,
    }));
  }, [data]);

  function handlePlay() {
    if (playerTracks.length === 0) return;
    playAll(playerTracks, 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      radio: data ? { seedType: "playlist", seedId: data.id } : undefined,
    });
  }

  function handleShuffle() {
    if (playerTracks.length === 0) return;
    playAll(shuffleArray(playerTracks), 0, {
      type: "playlist",
      name: data?.name || "Playlist",
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
    const shareUrl = `${window.location.origin}/playlist/${data.id}`;
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
    track: { title: string; artist: string; album?: string; duration?: number; path?: string },
  ) {
    if (!track.path) return;
    try {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", {
        tracks: [{
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
    navidrome_id?: string;
  }) {
    openCreatePlaylist({
      tracks: track.path ? [{
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        path: track.path,
        libraryTrackId: track.library_track_id,
        navidromeId: track.navidrome_id,
      }] : [],
    });
  }

  async function handleRegenerate() {
    if (!id) return;
    try {
      await api(`/api/playlists/${id}/generate`, "POST");
      toast.success("Playlist regenerated");
      refetch();
    } catch {
      toast.error("Failed to regenerate playlist");
    }
  }

  async function handleSavePlaylist(payload: {
    name: string;
    description: string;
    coverDataUrl: string | null;
    tracks: PlaylistComposerTrack[];
  }) {
    if (!id || !data) return;
    setSaving(true);
    try {
      await api(`/api/playlists/${id}`, "PUT", {
        name: payload.name,
        description: payload.description,
        cover_data_url: payload.coverDataUrl,
      });

      const originalByEntryId = new Map(
        editableTracks
          .filter((track) => track.playlistEntryId != null)
          .map((track) => [track.playlistEntryId as number, track]),
      );

      const nextEntryIds = new Set(
        payload.tracks
          .map((track) => track.playlistEntryId)
          .filter((value): value is number => value != null),
      );

      const removedTracks = [...originalByEntryId.values()]
        .filter((track) => !nextEntryIds.has(track.playlistEntryId as number))
        .sort((a, b) => (b.playlistPosition || 0) - (a.playlistPosition || 0));

      for (const track of removedTracks) {
        if (track.playlistPosition != null) {
          await api(`/api/playlists/${id}/tracks/${track.playlistPosition}`, "DELETE");
        }
      }

      const newTracks = payload.tracks.filter((track) => track.playlistEntryId == null && track.path);
      if (newTracks.length > 0) {
        await api(`/api/playlists/${id}/tracks`, "POST", {
          tracks: newTracks.map((track) => ({
            path: track.path,
            title: track.title,
            artist: track.artist,
            album: track.album || "",
            duration: track.duration || 0,
          })),
        });
      }

      toast.success("Playlist updated");
      setEditorOpen(false);
      refetch();
    } catch {
      toast.error("Failed to update playlist");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePlaylist() {
    if (!id) return;
    setDeleting(true);
    try {
      await api(`/api/playlists/${id}`, "DELETE");
      toast.success("Playlist deleted");
      navigate("/library?tab=playlists");
    } catch {
      toast.error("Failed to delete playlist");
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="text-primary animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Playlist not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
          <PlaylistArtwork
            name={data.name}
            coverDataUrl={data.cover_data_url}
            tracks={data.tracks}
            className="w-40 h-40 sm:w-48 sm:h-48 rounded-2xl shadow-2xl flex-shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-foreground truncate">{data.name}</h1>
              {data.is_smart && (
                <span className="inline-flex items-center rounded-md border border-primary/30 text-primary text-[10px] px-1.5 py-0 font-medium">
                  <Sparkles size={10} className="mr-0.5" />
                  Smart
                </span>
              )}
            </div>
            {data.description && (
              <p className="text-sm text-muted-foreground mb-2">{data.description}</p>
            )}
            <div className="text-xs text-muted-foreground">
              {data.track_count} track{data.track_count !== 1 ? "s" : ""}
              {data.total_duration > 0 &&
                ` · ${formatTotalDuration(data.total_duration)}`}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button
            onClick={handlePlay}
            disabled={playerTracks.length === 0}
            className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Play size={16} fill="currentColor" />
            Play
          </button>
        <button
          onClick={handleShuffle}
          disabled={playerTracks.length === 0}
          className="flex items-center gap-2 rounded-lg border border-white/20 px-5 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors disabled:opacity-50"
        >
          <Shuffle size={16} />
          Shuffle
        </button>
        <button
          onClick={handlePlaylistRadio}
          disabled={playerTracks.length === 0}
          className="flex items-center gap-2 rounded-lg border border-white/20 px-5 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors disabled:opacity-50"
        >
          <Radio size={16} />
          Playlist Radio
        </button>
        <button
          onClick={() => setEditorOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
        >
            <Pencil size={16} />
            Edit
          </button>
          <button
            onClick={handleShare}
            className="flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
          >
            <Share2 size={16} />
            Share
          </button>
          <button
            onClick={() => setDeleteOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-red-500/25 px-4 py-2.5 text-sm font-medium text-red-300 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={16} />
            Delete
          </button>
          {data.is_smart && (
            <button
              onClick={handleRegenerate}
              className="flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
            >
              <RefreshCw size={16} />
              Regenerate
            </button>
          )}
        </div>
      </div>

      {/* Track list */}
      {data.tracks.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-muted-foreground">
            This playlist has no tracks yet
          </p>
        </div>
      ) : (
        <div>
          {data.tracks.map((t, i) => (
            <TrackRow
              key={`${t.track_path}-${t.position}`}
              track={{
                id: t.track_id,
                title: t.title,
                artist: t.artist,
                artist_id: t.artist_id,
                artist_slug: t.artist_slug,
                album: t.album,
                album_id: t.album_id,
                album_slug: t.album_slug,
                duration: t.duration,
                path: t.track_path,
                navidrome_id: t.navidrome_id,
                library_track_id: t.track_id,
              }}
              index={i + 1}
              showArtist
              showAlbum
              playlistOptions={(playlistOptions || [])
                .filter((playlist) => playlist.id !== data.id)
                .map((playlist) => ({ id: playlist.id, name: playlist.name }))}
              onAddToPlaylist={handleAddTrackToPlaylist}
              onCreatePlaylist={handleCreatePlaylistFromTrack}
            />
          ))}
        </div>
      )}

      <PlaylistCreateModal
        open={editorOpen}
        mode="edit"
        initialName={data.name}
        initialDescription={data.description}
        initialCoverDataUrl={data.cover_data_url}
        initialTracks={editableTracks}
        submitting={saving}
        onClose={() => setEditorOpen(false)}
        onSubmit={handleSavePlaylist}
      />

      <AppModal open={deleteOpen} onClose={() => !deleting && setDeleteOpen(false)} maxWidthClassName="sm:max-w-md">
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Delete playlist</h2>
            <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
          </div>
          <ModalCloseButton onClick={() => setDeleteOpen(false)} disabled={deleting} />
        </ModalHeader>
        <ModalBody className="px-5 py-5">
          <p className="text-sm text-muted-foreground">
            Delete <span className="text-foreground font-medium">{data.name}</span> and remove all its track entries?
          </p>
        </ModalBody>
        <ModalFooter className="flex items-center justify-end gap-3 px-5 py-4">
          <button
            type="button"
            className="rounded-xl px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
            onClick={() => setDeleteOpen(false)}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-500/90 transition-colors disabled:opacity-50"
            onClick={handleDeletePlaylist}
            disabled={deleting}
          >
            {deleting ? <Loader2 size={15} className="animate-spin" /> : null}
            Delete playlist
          </button>
        </ModalFooter>
      </AppModal>
    </div>
  );
}
