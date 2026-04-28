import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AlertCircle, ArrowDownToLine, CheckCircle2, Play, Shuffle, Loader2, Sparkles, RefreshCw, Pencil, Trash2, Share2, Radio, Users, Copy, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { useLazyPlaylistOptions } from "@/hooks/use-lazy-playlist-options";
import { api } from "@/lib/api";
import { TrackRow } from "@/components/cards/TrackRow";
import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { PlaylistTrackFilterBar, filterPlaylistTracks } from "@/components/playlists/PlaylistTrackFilterBar";
import {
  PlaylistCreateModal,
  type PlaylistComposerTrack,
} from "@/components/playlists/PlaylistCreateModal";
import { AppModal, ModalBody, ModalFooter, ModalHeader, ModalCloseButton } from "@crate/ui/primitives/AppModal";
import { QrCodeImage } from "@crate/ui/primitives/QrCodeImage";
import { useAuth } from "@/contexts/AuthContext";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { isOfflineBusy } from "@/lib/offline";
import { fetchPlaylistRadio } from "@/lib/radio";
import { shuffleArray, formatTotalDuration } from "@/lib/utils";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { OfflineBadge } from "@/components/offline/OfflineBadge";

interface PlaylistTrack {
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

interface PlaylistData {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  visibility?: "public" | "private";
  is_collaborative?: boolean;
  user_id: number;
  is_smart: boolean;
  smart_rules?: unknown;
  track_count: number;
  total_duration: number;
  created_at: string;
  updated_at: string;
  artwork_tracks?: PlaylistArtworkTrack[];
  members?: PlaylistMember[];
  tracks: PlaylistTrack[];
}

interface PlaylistMember {
  playlist_id: number;
  user_id: number;
  role: "owner" | "collab";
  invited_by?: number | null;
  created_at: string;
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
}

interface PlaylistInvite {
  token: string;
  join_url: string;
  qr_value: string;
  expires_at?: string | null;
}



export function Playlist() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const { data, loading, refetch } = useApi<PlaylistData>(
    id ? `/api/playlists/${id}` : null,
  );
  const { playlistOptions, ensurePlaylistOptionsLoaded } = useLazyPlaylistOptions();
  const { playAll } = usePlayerActions();
  const { openCreatePlaylist } = usePlaylistComposer();
  const { supported: offlineSupported, getPlaylistState, getPlaylistRecord, togglePlaylistOffline } = useOffline();
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteData, setInviteData] = useState<PlaylistInvite | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<number | null>(null);
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

  const members = data?.members || [];
  const isOwner = Boolean(user && members.some((member) => member.user_id === user.id && member.role === "owner"));
  const inviteLink = inviteData ? `${window.location.origin}${inviteData.join_url}` : null;
  const offlineState = getPlaylistState(data?.id);
  const offlineRecord = getPlaylistRecord(data?.id);
  const offlineBusy = isOfflineBusy(offlineState);
  const offlineProgress =
    offlineRecord?.trackCount
      ? `${Math.min(offlineRecord.readyTrackCount || 0, offlineRecord.trackCount)}/${offlineRecord.trackCount}`
      : null;
  const offlineButtonLabel =
    data?.is_smart
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
    data?.is_smart
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

  const editableTracks = useMemo<PlaylistComposerTrack[]>(() => {
    if (!data?.tracks?.length) return [];
    return data.tracks.map((track) => ({
      title: track.title || "Unknown",
      artist: track.artist || "",
      album: track.album,
      duration: track.duration,
      path: track.track_path,
      libraryTrackId: track.track_id,
      playlistEntryId: track.id,
      playlistPosition: track.position,
    }));
  }, [data]);

  const filteredTracks = useMemo(
    () => filterPlaylistTracks(data?.tracks || [], deferredFilterQuery),
    [data?.tracks, deferredFilterQuery],
  );
  const destinationPlaylistOptions = useMemo(
    () => playlistOptions.filter((playlist) => playlist.id !== data?.id),
    [playlistOptions, data?.id],
  );

  function handlePlay() {
    if (playerTracks.length === 0) return;
    playAll(playerTracks, 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      href: data ? `/playlists/${data.id}` : undefined,
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
      href: `/playlists/${data.id}`,
      radio: { seedType: "playlist", seedId: data.id },
    });
  }

  function handleShuffle() {
    if (playerTracks.length === 0) return;
    playAll(shuffleArray(playerTracks), 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      href: data ? `/playlists/${data.id}` : undefined,
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
    visibility: "public" | "private";
    isCollaborative: boolean;
    tracks: PlaylistComposerTrack[];
  }) {
    if (!id || !data) return;
    setSaving(true);
    try {
      await api(`/api/playlists/${id}`, "PUT", {
        name: payload.name,
        description: payload.description,
        cover_data_url: payload.coverDataUrl,
        visibility: payload.visibility,
        is_collaborative: payload.isCollaborative,
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

  async function handleCreateCollaboratorInvite() {
    if (!data) return;
    setCreatingInvite(true);
    try {
      const invite = await api<PlaylistInvite>(`/api/playlists/${data.id}/invites`, "POST", {});
      setInviteData(invite);
      toast.success("Collaborator invite created");
    } catch {
      toast.error("Failed to create playlist invite");
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleCopyInviteLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success("Invite link copied");
    } catch {
      toast.error("Failed to copy invite link");
    }
  }

  async function handleRemoveMember(memberUserId: number) {
    if (!data) return;
    setRemovingMemberId(memberUserId);
    try {
      await api(`/api/playlists/${data.id}/members/${memberUserId}`, "DELETE");
      toast.success("Collaborator removed");
      refetch();
    } catch {
      toast.error("Failed to remove collaborator");
    } finally {
      setRemovingMemberId(null);
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
              <OfflineBadge state={offlineState} />
              {data.is_smart && (
                <span className="inline-flex items-center rounded-md border border-primary/30 text-primary text-[10px] px-1.5 py-0 font-medium">
                  <Sparkles size={10} className="mr-0.5" />
                  Smart
                </span>
              )}
              <span className="inline-flex items-center rounded-md border border-white/10 px-1.5 py-0 text-[10px] font-medium text-white/60">
                {data.visibility === "public" ? "Public" : "Private"}
              </span>
              {data.is_collaborative ? (
                <span className="inline-flex items-center rounded-md border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0 text-[10px] font-medium text-cyan-300">
                  Collaborative
                </span>
              ) : null}
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
          onClick={handleToggleOffline}
          disabled={!offlineSupported || data.is_smart || offlineBusy}
          className={`flex h-11 w-11 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
            offlineState === "ready"
              ? "border border-cyan-400/25 bg-cyan-400/10 text-cyan-200"
              : offlineBusy
                ? "border border-primary/25 bg-primary/10 text-primary"
                : offlineState === "error"
                  ? "border border-amber-400/25 bg-amber-400/10 text-amber-200"
                  : "border-white/20 text-foreground hover:bg-white/10"
          }`}
          aria-label={offlineState === "ready" ? "Remove offline copy" : "Make available offline"}
          title={offlineButtonLabel}
        >
          {offlineState === "ready" ? (
            <CheckCircle2 size={16} />
          ) : offlineBusy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : offlineState === "error" ? (
            <AlertCircle size={16} />
          ) : (
            <ArrowDownToLine size={16} />
          )}
        </button>
        {data.is_collaborative ? (
          <button
            onClick={() => setMembersOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
          >
            <Users size={16} />
            Collaborators
          </button>
        ) : null}
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

        {offlineStatusDetail ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {offlineStatusDetail}
          </p>
        ) : null}
      </div>

      <PlaylistTrackFilterBar
        query={filterQuery}
        onQueryChange={setFilterQuery}
        totalCount={data.tracks.length}
        filteredCount={filteredTracks.length}
      />

      {/* Track list */}
      {data.tracks.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-muted-foreground">
            This playlist has no tracks yet
          </p>
        </div>
      ) : filteredTracks.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-muted-foreground">
            No tracks match this filter
          </p>
        </div>
      ) : (
        <div>
          {filteredTracks.map((t, i) => (
            <TrackRow
              key={t.id ?? `${t.track_path}-${t.position}`}
              track={{
                id: t.track_storage_id ?? t.track_id,
                storage_id: t.track_storage_id,
                title: t.title,
                artist: t.artist,
                artist_id: t.artist_id,
                artist_slug: t.artist_slug,
                album: t.album,
                album_id: t.album_id,
                album_slug: t.album_slug,
                duration: t.duration,
                path: t.track_path,
                library_track_id: t.track_id,
              }}
              index={i + 1}
              showArtist
              showAlbum
              playlistOptions={destinationPlaylistOptions}
              onAddToPlaylist={handleAddTrackToPlaylist}
              onCreatePlaylist={handleCreatePlaylistFromTrack}
              onActionMenuOpen={ensurePlaylistOptionsLoaded}
              onPlayOverride={() => handlePlayTrack(t.id)}
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
        initialVisibility={data.visibility || "private"}
        initialCollaborative={Boolean(data.is_collaborative)}
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

      <AppModal open={membersOpen} onClose={() => setMembersOpen(false)} maxWidthClassName="sm:max-w-lg">
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Collaborators</h2>
            <p className="text-xs text-muted-foreground">
              {data.is_collaborative
                ? "Share a private invite link and manage the people who can edit this playlist."
                : "This playlist is not collaborative yet."}
            </p>
          </div>
          <ModalCloseButton onClick={() => setMembersOpen(false)} />
        </ModalHeader>
        <ModalBody className="space-y-5 px-5 py-5">
          {data.is_collaborative && isOwner ? (
            <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">Invite a collaborator</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Owners can create share links and QR codes for private beta-style collaboration.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCreateCollaboratorInvite}
                  disabled={creatingInvite}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {creatingInvite ? <Loader2 size={15} className="animate-spin" /> : <Users size={15} />}
                  Create invite
                </button>
              </div>
              {inviteLink ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-[0.9fr_1.1fr]">
                  <div className="flex justify-center">
                    <QrCodeImage
                      value={inviteLink}
                      size={160}
                      className="rounded-2xl border border-white/10 bg-[#0f1116] p-3"
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-muted-foreground break-all">
                      {inviteLink}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyInviteLink}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
                    >
                      <Copy size={15} />
                      Copy invite link
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-3">
            {members.map((member) => {
              const label = member.display_name || member.username || `User ${member.user_id}`;
              const isCurrentUser = user?.id === member.user_id;
              return (
                <div
                  key={`${member.playlist_id}-${member.user_id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{label}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {member.username ? `@${member.username}` : "Profile"} · {member.role}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-muted-foreground">
                      {member.role === "owner" ? "Owner" : "Collab"}
                    </div>
                    {isOwner && member.role !== "owner" && !isCurrentUser ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(member.user_id)}
                        disabled={removingMemberId === member.user_id}
                        className="inline-flex items-center gap-1 rounded-full border border-red-500/20 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-60"
                      >
                        {removingMemberId === member.user_id ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </ModalBody>
      </AppModal>
    </div>
  );
}
