import { PlaylistArtwork } from "@/components/playlists/PlaylistArtwork";
import { PlaylistHeroSection } from "@/components/playlists/PlaylistHeroSection";
import { PlaylistTrackFilterBar } from "@/components/playlists/PlaylistTrackFilterBar";
import { CuratedPlaylistTrackList } from "@/components/playlists/CuratedPlaylistTrackList";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import type { CuratedPlaylistPageController } from "@/pages/use-curated-playlist-page-controller";

export function CuratedPlaylistContent({
  page,
}: {
  page: CuratedPlaylistPageController;
}) {
  const {
    data,
    filterQuery,
    filteredTracks,
    handleAddTrackToPlaylist,
    handleCreatePlaylistFromTrack,
    handlePlay,
    handlePlayTrack,
    handleShuffle,
    offlineState,
    offlineStatusDetail,
    playlistMenuItems,
    playlistMetaItems,
    playlistOptions,
    playerTracks,
    secondaryActions,
    setFilterQuery,
    t,
    ensurePlaylistOptionsLoaded,
  } = page;

  if (!data) return null;

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      <PlaylistHeroSection
        title={data.name}
        subtitle={t("playlist.subtitle.crate")}
        description={data.description}
        metaItems={playlistMetaItems}
        badges={<OfflineBadge state={offlineState} />}
        artwork={(className) => (
          <PlaylistArtwork
            name={data.name}
            coverDataUrl={data.cover_data_url}
            tracks={data.artwork_tracks}
            className={className}
          />
        )}
        menuImageUrl={data.cover_data_url}
        menuImageAlt={data.name}
        onPlay={handlePlay}
        onShuffle={handleShuffle}
        playDisabled={playerTracks.length === 0}
        shuffleDisabled={playerTracks.length === 0}
        secondaryActions={secondaryActions}
        menuItems={playlistMenuItems}
      />

      <div className="mx-auto w-full max-w-[1480px] space-y-6 px-4 pb-8 sm:px-6">
        {offlineStatusDetail ? (
          <p className="text-xs text-text-muted">{offlineStatusDetail}</p>
        ) : null}

        <PlaylistTrackFilterBar
          query={filterQuery}
          onQueryChange={setFilterQuery}
          totalCount={data.tracks.length}
          filteredCount={filteredTracks.length}
        />

        {data.tracks.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-text-muted">
              {t("playlist.empty.noTracks")}
            </p>
          </div>
        ) : filteredTracks.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-text-muted">
              {t("playlist.empty.noFilter")}
            </p>
          </div>
        ) : (
          <CuratedPlaylistTrackList
            tracks={filteredTracks}
            playlistOptions={playlistOptions}
            onAddToPlaylist={handleAddTrackToPlaylist}
            onCreatePlaylist={handleCreatePlaylistFromTrack}
            onActionMenuOpen={ensurePlaylistOptionsLoaded}
            onPlayTrack={handlePlayTrack}
          />
        )}
      </div>
    </div>
  );
}
