import { Sparkles } from "@crate/ui/icons";

import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import { PlaylistCollaboratorsModal } from "@/components/playlists/PlaylistCollaboratorsModal";
import { PlaylistDeleteModal } from "@/components/playlists/PlaylistDeleteModal";
import { PlaylistTrackList } from "@/components/playlists/PlaylistTrackList";
import {
  PlaylistArtwork,
  type PlaylistArtworkTrack,
} from "@/components/playlists/PlaylistArtwork";
import {
  PlaylistCreateModal,
  type PlaylistComposerTrack,
} from "@/components/playlists/PlaylistCreateModal";
import { PlaylistHeroSection } from "@/components/playlists/PlaylistHeroSection";
import { PlaylistTrackFilterBar } from "@/components/playlists/PlaylistTrackFilterBar";
import type { AuthUser } from "@/contexts/auth-context";
import type { PlaylistData } from "@/pages/playlist-types";
import type { PlaylistPageController } from "@/pages/use-playlist-page-controller";

type LoadedPlaylistPageController = Omit<PlaylistPageController, "data"> & {
  data: PlaylistData;
};

function PlaylistBadges({
  data,
  offlineState,
  t,
}: {
  data: PlaylistData;
  offlineState: LoadedPlaylistPageController["offlineState"];
  t: LoadedPlaylistPageController["t"];
}) {
  return (
    <>
      <OfflineBadge state={offlineState} />
      {data.is_smart ? (
        <span className="inline-flex items-center rounded-md border border-accent-action/30 px-1.5 py-0 text-xs font-medium text-accent-action">
          <Sparkles size={10} className="mr-0.5" />
          {t("playlist.badges.smart")}
        </span>
      ) : null}
      <span className="inline-flex items-center rounded-md border border-border-quiet px-1.5 py-0 text-xs font-medium text-text-primary/60">
        {data.visibility === "public"
          ? t("playlist.visibility.public")
          : t("playlist.visibility.private")}
      </span>
      {data.is_collaborative ? (
        <span className="inline-flex items-center rounded-md border border-accent-action/20 bg-accent-action/10 px-1.5 py-0 text-xs font-medium text-text-accent">
          {t("playlist.badges.collaborative")}
        </span>
      ) : null}
    </>
  );
}

export function PlaylistContent({
  page,
  user,
}: {
  page: LoadedPlaylistPageController;
  user: AuthUser | null;
}) {
  const { data } = page;
  const artworkTracks = page.playlistArtworkTracks as PlaylistArtworkTrack[];

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      <PlaylistHeroSection
        title={data.name}
        subtitle={
          data.visibility === "public"
            ? page.t("playlist.visibility.publicPlaylist")
            : page.t("playlist.visibility.privatePlaylist")
        }
        description={data.description}
        metaItems={page.playlistMetaItems}
        badges={
          <PlaylistBadges
            data={data}
            offlineState={page.offlineState}
            t={page.t}
          />
        }
        artwork={(className) => (
          <PlaylistArtwork
            name={data.name}
            coverDataUrl={data.cover_data_url}
            tracks={artworkTracks}
            className={className}
          />
        )}
        menuImageUrl={data.cover_data_url}
        menuImageAlt={data.name}
        onPlay={page.handlePlay}
        onShuffle={page.handleShuffle}
        playDisabled={page.playerTracks.length === 0}
        shuffleDisabled={page.playerTracks.length === 0}
        secondaryActions={page.secondaryActions}
        menuItems={page.playlistMenuItems}
      />

      <div className="mx-auto w-full max-w-[1480px] space-y-6 px-4 pb-8 sm:px-6">
        {page.offlineStatusDetail ? (
          <p className="text-xs text-text-muted">{page.offlineStatusDetail}</p>
        ) : null}
        <PlaylistTrackFilterBar
          query={page.filterQuery}
          onQueryChange={page.setFilterQuery}
          totalCount={data.tracks.length}
          filteredCount={page.filteredTracks.length}
        />
        {data.tracks.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-text-muted">
              {page.t("playlist.empty.noTracks")}
            </p>
          </div>
        ) : page.filteredTracks.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-text-muted">
              {page.t("playlist.empty.noFilter")}
            </p>
          </div>
        ) : (
          <PlaylistTrackList
            filteredTracks={page.filteredTracks}
            onActionMenuOpen={page.ensurePlaylistOptionsLoaded}
            onAddToPlaylist={page.handleAddTrackToPlaylist}
            onCreatePlaylist={page.handleCreatePlaylistFromTrack}
            onPlayTrack={page.handlePlayTrack}
            playlistOptions={page.destinationPlaylistOptions}
          />
        )}
      </div>

      <PlaylistCreateModal
        open={page.editorOpen}
        mode="edit"
        initialName={data.name}
        initialDescription={data.description}
        initialCoverDataUrl={data.cover_data_url}
        initialVisibility={data.visibility || "private"}
        initialCollaborative={Boolean(data.is_collaborative)}
        initialTracks={page.editableTracks as PlaylistComposerTrack[]}
        submitting={page.saving}
        onClose={() => page.setEditorOpen(false)}
        onSubmit={page.handleSavePlaylist}
      />

      <PlaylistDeleteModal
        open={page.deleteOpen}
        deleting={page.deleting}
        name={data.name}
        onClose={() => page.setDeleteOpen(false)}
        onDelete={() => void page.handleDeletePlaylist()}
        t={page.t}
      />

      <PlaylistCollaboratorsModal
        open={page.membersOpen}
        data={data}
        members={page.members}
        isOwner={page.isOwner}
        user={user}
        inviteLink={page.inviteLink}
        creatingInvite={page.creatingInvite}
        removingMemberId={page.removingMemberId}
        onClose={() => page.setMembersOpen(false)}
        onCreateInvite={() => void page.handleCreateCollaboratorInvite()}
        onCopyInviteLink={() => void page.handleCopyInviteLink()}
        onRemoveMember={(memberUserId) =>
          void page.handleRemoveMember(memberUserId)
        }
        t={page.t}
      />
    </div>
  );
}
