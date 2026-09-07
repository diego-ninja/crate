import { memo } from "react";
import { useNavigate } from "react-router";
import { Disc3 } from "@crate/ui/icons";

import { ItemActionMenu } from "@/components/actions/ItemActionMenu";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { albumPagePath } from "@/lib/library-routes";
import { isOfflineBusy } from "@/lib/offline";
import { cn } from "@/lib/utils";
import {
  AlbumCardArtworkControls,
  AlbumCardArtworkSurface,
  AlbumCardDetails,
  useAlbumCardModel,
  useAlbumCardPlayback,
  type AlbumCardProps,
} from "./AlbumCardParts";

export type { AlbumCardProps } from "./AlbumCardParts";

export const AlbumCard = memo(function AlbumCard({
  artist,
  album,
  albumId,
  albumEntityUid,
  globalAlbumUid,
  artistEntityUid,
  albumSlug,
  artistSlug,
  year,
  cover,
  isPreRelease = false,
  releaseDate,
  compact,
  layout = "rail",
}: AlbumCardProps) {
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const model = useAlbumCardModel({
    artist,
    album,
    albumId,
    albumEntityUid,
    globalAlbumUid,
    artistEntityUid,
    albumSlug,
    artistSlug,
    year,
    cover,
    isPreRelease,
    releaseDate,
    compact,
    layout,
  });

  const { playing, handlePlayOverlay } = useAlbumCardPlayback({
    albumRouteInput: model.albumRouteInput,
    album,
    albumId,
    artist,
    coverUrl: model.coverUrl,
    globalAlbumUid,
    playAll,
  });

  return (
    <article
      className={cn(
        "group/card relative snap-start rounded-xl text-left transition-colors",
        layout === "grid"
          ? "listen-deferred-grid-item w-full min-w-0"
          : `shrink-0 ${compact ? "w-[120px]" : "w-[160px]"}`,
      )}
      onContextMenu={model.actionMenu.handleContextMenu}
      {...model.actionMenu.longPressHandlers}
    >
      <button
        type="button"
        className={cn(
          "group block w-full rounded-xl p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          model.offlineState === "ready"
            ? "bg-accent-action/[0.04]"
            : isOfflineBusy(model.offlineState)
              ? "bg-accent-action/[0.05]"
              : model.offlineState === "error"
                ? "bg-state-warning/[0.05]"
                : "hover:bg-text-primary/5",
        )}
        onClick={() => navigate(albumPagePath(model.albumRouteInput))}
        onKeyDown={(event) => {
          model.actionMenu.handleKeyboardTrigger(event);
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            navigate(albumPagePath(model.albumRouteInput));
          }
        }}
      >
        <AlbumCardArtworkSurface
          coverArtwork={model.coverArtwork}
          coverSizes={model.coverSizes}
          album={album}
          offlineState={model.offlineState}
          isPreRelease={model.isPreRelease}
        />
        <AlbumCardDetails
          album={album}
          artist={artist}
          year={year}
          isPreRelease={model.isPreRelease}
          releaseDate={model.releaseDate}
          offlineMeta={model.offlineMeta}
          offlineState={model.offlineState}
        />
      </button>
      <AlbumCardArtworkControls
        album={album}
        albumId={albumId}
        globalAlbumUid={globalAlbumUid}
        saved={model.saved}
        savedLabel={model.savedLabel}
        onToggleSaved={model.handleToggleSaved}
        playing={playing}
        onPlayOverlay={handlePlayOverlay}
      />
      <ItemActionMenu
        actions={model.actions}
        header={{
          type: "media",
          title: album,
          subtitle: artist,
          imageUrl: model.menuCoverUrl,
          imageAlt: album,
          imageShape: "square",
          fallbackIcon: Disc3,
        }}
        open={model.actionMenu.open}
        position={model.actionMenu.position}
        menuRef={model.actionMenu.menuRef}
        onClose={model.actionMenu.close}
      />
    </article>
  );
});
