import { AlbumActions } from "@/components/album/AlbumActions";
import { AlbumHero } from "@/components/album/AlbumHero";
import { AlbumMobileMenuPortal } from "@/components/album/AlbumMobileMenuPortal";
import { AlbumTrackList } from "@/components/album/AlbumTrackList";
import type { LoadedAlbumPageController } from "@/pages/use-album-page-controller";

function albumGenreSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-");
}

export function AlbumContent({ page }: { page: LoadedAlbumPageController }) {
  const {
    albumHeroInfoRef,
    albumPrimaryActionsRef,
    albumMenuController,
    closeAlbumMenu,
    data,
    displayName,
    globalAlbumUid,
    handleAddSelectedToPlaylist,
    handleAddTrackToPlaylist,
    handleAlbumRadio,
    handleCreatePlaylistFromSelection,
    handleCreatePlaylistFromTrack,
    handlePlay,
    handlePlayTrack,
    handleSelectionActionMenuOpen,
    handleShuffle,
    handleToggleSelectionPlaylistPicker,
    handleTrackSelection,
    isDesktop,
    isPreRelease,
    navigate,
    playerTracks,
    playlists,
    presentation,
    selectedAlbumTracks,
    selectedTrackIds,
    selectionBarRef,
    selectionMenuController,
    selectionPlaylistPickerOpen,
    ensurePlaylistOptionsLoaded,
    t,
  } = page;

  return (
    <div
      data-testid="album-shell"
      className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6"
      style={presentation.albumHeroStyle}
    >
      <AlbumMobileMenuPortal
        albumMenuController={albumMenuController}
        albumMenuItems={presentation.albumMenuItems}
        closeAlbumMenu={closeAlbumMenu}
        coverUrl={presentation.coverUrl}
        data={data}
        displayName={displayName}
        isDesktop={isDesktop}
        onToggleAlbumMenu={presentation.handleToggleAlbumMenu}
        t={t}
      />
      <AlbumHero
        data={data}
        coverUrl={presentation.coverUrl}
        artistPhotoUrl={presentation.artistPhotoUrl}
        displayName={displayName}
        isPreRelease={isPreRelease}
        canPersistAlbum={presentation.canPersistAlbum}
        offlineState={presentation.offlineState}
        year={presentation.year}
        genre={presentation.genre}
        playerTrackCount={playerTracks.length}
        qualityBadges={presentation.qualityBadges}
        visibleContributor={presentation.visibleContributor}
        primaryContributorName={presentation.primaryContributorName}
        primaryContributorPath={presentation.primaryContributorPath}
        primaryContributorSource={presentation.primaryContributorSource}
        albumHeroInfoRef={albumHeroInfoRef}
        onArtistNavigate={presentation.handleGoToArtist}
        onGenreSelect={(item) =>
          navigate(
            `/explore?genre=${encodeURIComponent(
              item.slug || albumGenreSlug(item.name),
            )}`,
          )
        }
        t={t}
      />
      <AlbumActions
        data={data}
        coverUrl={presentation.coverUrl}
        displayName={displayName}
        globalAlbumUid={globalAlbumUid}
        state={{
          isPreRelease,
          canPersistAlbum: presentation.canPersistAlbum,
          canSaveAlbum: presentation.canSaveAlbum,
          offlineSupported: presentation.offlineSupported,
          offlineState: presentation.offlineState,
          offlineBusy: presentation.offlineBusy,
          offlineButtonLabel: presentation.offlineButtonLabel,
          offlineStatusDetail: presentation.offlineStatusDetail,
          saved: presentation.saved,
          remoteOnly: presentation.remoteOnly,
          isDesktop,
          playerTracksAvailable: playerTracks.length > 0,
        }}
        menu={{
          controller: albumMenuController,
          items: presentation.albumMenuItems,
          primaryRef: albumPrimaryActionsRef,
        }}
        actions={{
          onCloseAlbumMenu: closeAlbumMenu,
          onToggleAlbumMenu: presentation.handleToggleAlbumMenu,
          onAlbumRadio: handleAlbumRadio,
          onToggleOffline: presentation.handleToggleOffline,
          onToggleSaved: presentation.handleToggleSaved,
          onShare: presentation.handleShare,
          onPlay: handlePlay,
          onShuffle: handleShuffle,
        }}
        t={t}
      />
      <AlbumTrackList
        data={data}
        coverUrl={presentation.coverUrl}
        selectedTrackIds={selectedTrackIds}
        selectedAlbumTracks={selectedAlbumTracks}
        isDesktop={isDesktop}
        canPersistAlbum={presentation.canPersistAlbum}
        playlists={playlists}
        selectionPlaylistPickerOpen={selectionPlaylistPickerOpen}
        selectionMenuController={selectionMenuController}
        selectionMenuItems={presentation.selectionMenuItems}
        selectionBarRef={selectionBarRef}
        onToggleSelectionPlaylistPicker={handleToggleSelectionPlaylistPicker}
        onCreatePlaylistFromSelection={handleCreatePlaylistFromSelection}
        onAddSelectedToPlaylist={handleAddSelectedToPlaylist}
        onClearSelection={page.clearTrackSelection}
        onCloseSelectionMenu={page.handleCloseSelectionMenu}
        onAddTrackToPlaylist={handleAddTrackToPlaylist}
        onCreatePlaylistFromTrack={handleCreatePlaylistFromTrack}
        onActionMenuOpen={ensurePlaylistOptionsLoaded}
        onPlayTrack={handlePlayTrack}
        onTrackSelection={handleTrackSelection}
        onSelectionActionMenuOpen={handleSelectionActionMenuOpen}
        trackPreviewId={presentation.trackPreviewId}
        sharedTrackClass={presentation.sharedTrackClass}
        albumTrackRowData={presentation.albumTrackRowData}
        t={t}
      />
    </div>
  );
}
