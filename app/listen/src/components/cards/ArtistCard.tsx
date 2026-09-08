import { useNavigate } from "react-router";
import { UserRound } from "@crate/ui/icons";

import {
  useArtistCardFollow,
  useArtistCardModel,
  useArtistCardPlayback,
  ArtistCardArtwork,
  ArtistCardDetails,
  ArtistCardInlineActions,
  type ArtistCardProps,
} from "./ArtistCardParts";
import { ItemActionMenu } from "@/components/actions/ItemActionMenu";
import { usePlayerActions } from "@/contexts/PlayerContext";

export type { ArtistCardProps } from "./ArtistCardParts";

export function ArtistCard({
  name,
  artistId,
  artistEntityUid,
  globalArtistUid,
  artistSlug,
  photo,
  hasPhoto,
  subtitle,
  compact,
  href,
  external = false,
  imageTone = "normal",
  large = false,
  layout = "rail",
  fillGrid = false,
}: ArtistCardProps) {
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const model = useArtistCardModel({
    name,
    artistId,
    artistEntityUid,
    globalArtistUid,
    artistSlug,
    photo,
    hasPhoto,
    subtitle,
    compact: Boolean(compact),
    href,
    external,
    imageTone,
    large,
    layout,
    fillGrid,
  });
  const playback = useArtistCardPlayback({
    artistId,
    artistEntityUid,
    globalArtistUid,
    artistSlug,
    name,
    playAll,
    t: model.t,
  });
  const follow = useArtistCardFollow({
    artistId,
    globalArtistUid,
    name,
    toggleArtistFollow: model.toggleArtistFollow,
  });
  const content = (
    <>
      <ArtistCardArtwork
        photoArtwork={model.photoArtwork}
        name={name}
        imageSize={model.imageSize}
        artworkWidth={model.artworkWidth}
        fillGrid={model.fillGrid}
        imageTone={model.imageTone}
        monogram={model.monogram}
      >
        {!external && model.hasPlayableArtist ? (
          <ArtistCardInlineActions
            artistName={name}
            following={model.following}
            hasPlayableArtist={model.hasPlayableArtist}
            canUseInlineHoverActions={model.canUseInlineHoverActions}
            playingTopTracks={playback.playingTopTracks}
            togglingFollow={follow.togglingFollow}
            handlePlayTopTracks={playback.handlePlayTopTracks}
            handleToggleFollow={follow.handleToggleFollow}
            t={model.t}
          />
        ) : null}
      </ArtistCardArtwork>
      <ArtistCardDetails name={name} subtitle={subtitle} />
    </>
  );

  if (external) {
    return (
      <a
        href={model.targetHref}
        target="_blank"
        rel="noopener noreferrer"
        className={model.wrapperClassName}
      >
        {content}
      </a>
    );
  }

  return (
    <article
      className={model.wrapperClassName}
      onContextMenu={model.actionMenu.handleContextMenu}
      {...model.actionMenu.longPressHandlers}
    >
      <button
        type="button"
        className="group block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        onClick={() => navigate(model.targetHref)}
        onKeyDown={(event) => {
          model.actionMenu.handleKeyboardTrigger(event);
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            navigate(model.targetHref);
          }
        }}
      >
        {content}
      </button>
      <ItemActionMenu
        actions={model.actions}
        header={{
          type: "media",
          title: name,
          subtitle,
          imageUrl: model.menuPhotoUrl,
          imageAlt: name,
          imageShape: "circle",
          fallbackIcon: UserRound,
        }}
        open={model.actionMenu.open}
        position={model.actionMenu.position}
        menuRef={model.actionMenu.menuRef}
        onClose={model.actionMenu.close}
      />
    </article>
  );
}
