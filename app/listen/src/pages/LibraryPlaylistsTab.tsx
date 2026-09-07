import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Pencil, Plus, Trash2 } from "@crate/ui/icons";
import { toast } from "sonner";

import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { useApi } from "@/hooks/use-api";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { PlaylistListRow } from "@/components/playlists/PlaylistListRow";
import {
  PlaylistCreateModal,
  type PlaylistComposerTrack,
} from "@/components/playlists/PlaylistCreateModal";
import { api } from "@/lib/api";
import { formatTotalDuration } from "@/lib/utils";
import { toPlayableTrack } from "@/lib/playable-track";
import {
  hasTrackReference,
  toTrackReferencePayload,
} from "@/lib/track-reference";

import { EmptyState, Spinner } from "./LibraryPrimitives";
import type {
  CuratedPlaylist,
  LibraryPlaylistsPageData,
  Playlist,
  PlaylistDetail,
} from "./library-playlists-model";

function editableTracks(playlist: PlaylistDetail): PlaylistComposerTrack[] {
  return playlist.tracks.map((track) => ({
    ...toPlayableTrack(track),
    playlistEntryId: track.id,
    playlistPosition: track.position,
  }));
}

export function LibraryPlaylistsTab() {
  const { t } = useTranslation();
  const { data, loading, refetch } = useApi<LibraryPlaylistsPageData>(
    "/api/me/playlists-page",
  );
  const { openCreatePlaylist } = usePlaylistComposer();
  const [editingPlaylist, setEditingPlaylist] = useState<PlaylistDetail | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [deletingPlaylist, setDeletingPlaylist] = useState<Playlist | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const playlists = data?.playlists;
  const followedCurated = data?.followed_curated_playlists;

  if (loading) return <Spinner />;

  async function toggleSystemPlaylistFollow(playlist: CuratedPlaylist) {
    try {
      await api(`/api/curation/playlists/${playlist.id}/follow`, "DELETE");
      toast.success(
        t("playlist.toasts.removedNamedLibrary", { name: playlist.name }),
      );
      refetch();
    } catch {
      toast.error(t("playlist.toasts.updateFailed"));
    }
  }

  async function openPlaylistEditor(playlistId: number) {
    try {
      const detail = await api<PlaylistDetail>(`/api/playlists/${playlistId}`);
      setEditingPlaylist(detail);
    } catch {
      toast.error(t("playlist.toasts.loadFailed"));
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
    if (!editingPlaylist) return;
    setSaving(true);
    try {
      await api(`/api/playlists/${editingPlaylist.id}`, "PUT", {
        name: payload.name,
        description: payload.description,
        cover_data_url: payload.coverDataUrl,
        visibility: payload.visibility,
        is_collaborative: payload.isCollaborative,
      });

      const originalByEntryId = new Map(
        editableTracks(editingPlaylist)
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
          await api(
            `/api/playlists/${editingPlaylist.id}/tracks/${track.playlistPosition}`,
            "DELETE",
          );
        }
      }

      const newTracks = payload.tracks.filter(
        (track) => track.playlistEntryId == null && hasTrackReference(track),
      );
      if (newTracks.length > 0) {
        await api(`/api/playlists/${editingPlaylist.id}/tracks`, "POST", {
          tracks: newTracks.map((track) =>
            toTrackReferencePayload({
              ...track,
              album: track.album || "",
              duration: track.duration || 0,
            }),
          ),
        });
      }

      toast.success(t("playlist.toasts.updated"));
      setEditingPlaylist(null);
      refetch();
    } catch {
      toast.error(t("playlist.toasts.updateFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePlaylist() {
    if (!deletingPlaylist) return;
    setDeleting(true);
    try {
      await api(`/api/playlists/${deletingPlaylist.id}`, "DELETE");
      toast.success(t("playlist.toasts.deleted"));
      setDeletingPlaylist(null);
      refetch();
    } catch {
      toast.error(t("playlist.toasts.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => openCreatePlaylist()}
        className="library-new-playlist flex w-full items-center gap-2 rounded-lg bg-text-primary/5 px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-text-primary/10"
      >
        <Plus size={16} className="text-accent-action" />
        {t("library.playlists.new")}
      </button>

      {followedCurated && followedCurated.length > 0 ? (
        <div className="space-y-1">
          <div className="px-1 pb-1 text-xs font-bold uppercase tracking-wider text-text-primary/40">
            {t("explore.fromCrate.title")}
          </div>
          {followedCurated.map((playlist) => (
            <PlaylistListRow
              key={`curated-${playlist.id}`}
              playlistId={playlist.id}
              name={playlist.name}
              isSmart={playlist.is_smart}
              description={playlist.description}
              coverDataUrl={playlist.cover_data_url}
              artworkTracks={playlist.artwork_tracks}
              trackCount={playlist.track_count}
              meta={[
                playlist.category,
                playlist.follower_count > 0
                  ? `${playlist.follower_count} followers`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              href={`/curation/playlist/${playlist.id}`}
              detailEndpoint={`/api/curation/playlists/${playlist.id}`}
              crateManaged
              followState={{
                isFollowed: true,
                onToggle: async () => toggleSystemPlaylistFollow(playlist),
              }}
            />
          ))}
        </div>
      ) : null}

      {!playlists || playlists.length === 0 ? (
        !followedCurated || followedCurated.length === 0 ? (
          <EmptyState message={t("library.playlists.empty")} />
        ) : null
      ) : (
        <div className="space-y-1">
          <div className="px-1 pb-1 text-xs font-bold uppercase tracking-wider text-text-primary/40">
            {t("library.playlists.yours")}
          </div>
          {playlists.map((pl) => (
            <PlaylistListRow
              key={pl.id}
              playlistId={pl.id}
              name={pl.name}
              isSmart={pl.is_smart}
              description={pl.description}
              coverDataUrl={pl.cover_data_url}
              artworkTracks={pl.artwork_tracks}
              trackCount={pl.track_count}
              meta={
                pl.total_duration > 0
                  ? formatTotalDuration(pl.total_duration)
                  : undefined
              }
              href={`/playlist/${pl.id}`}
              detailEndpoint={`/api/playlists/${pl.id}`}
              badge={pl.is_smart ? "smart" : "personal"}
              extraActions={[
                {
                  key: "edit",
                  icon: Pencil,
                  title: t("common.edit"),
                  onClick: async () => openPlaylistEditor(pl.id),
                },
                {
                  key: "delete",
                  icon: Trash2,
                  title: t("common.delete"),
                  onClick: async () => setDeletingPlaylist(pl),
                  tone: "danger",
                },
              ]}
            />
          ))}
        </div>
      )}

      <PlaylistCreateModal
        open={!!editingPlaylist}
        mode="edit"
        initialName={editingPlaylist?.name}
        initialDescription={editingPlaylist?.description}
        initialCoverDataUrl={editingPlaylist?.cover_data_url}
        initialVisibility={editingPlaylist?.visibility || "private"}
        initialCollaborative={Boolean(editingPlaylist?.is_collaborative)}
        initialTracks={editingPlaylist ? editableTracks(editingPlaylist) : []}
        submitting={saving}
        onClose={() => setEditingPlaylist(null)}
        onSubmit={handleSavePlaylist}
      />

      <AppModal
        open={!!deletingPlaylist}
        onClose={() => !deleting && setDeletingPlaylist(null)}
        maxWidthClassName="sm:max-w-md"
      >
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("playlist.delete.title")}
            </h2>
            <p className="text-xs text-text-muted">
              {t("playlist.delete.subtitle")}
            </p>
          </div>
          <ModalCloseButton
            onClick={() => setDeletingPlaylist(null)}
            disabled={deleting}
          />
        </ModalHeader>
        <ModalBody className="p-5 ">
          <p className="text-sm text-text-muted">
            {t("playlist.delete.confirmPrefix")}{" "}
            <span className="font-medium text-text-primary">
              {deletingPlaylist?.name}
            </span>{" "}
            {t("playlist.delete.confirmSuffix")}
          </p>
        </ModalBody>
        <ModalFooter className="flex items-center justify-end gap-3 px-5 py-4">
          <button
            type="button"
            className="rounded-lg px-4 py-2.5 text-sm text-text-muted transition-colors hover:bg-text-primary/5 hover:text-text-primary"
            onClick={() => setDeletingPlaylist(null)}
            disabled={deleting}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-lg bg-state-danger px-4 py-2.5 text-sm font-medium text-state-danger-foreground transition-colors hover:bg-state-danger/90 disabled:opacity-50"
            onClick={() => void handleDeletePlaylist()}
          >
            {deleting ? <Loader2 size={15} className="animate-spin" /> : null}
            {t("playlist.delete.title")}
          </button>
        </ModalFooter>
      </AppModal>
    </div>
  );
}
