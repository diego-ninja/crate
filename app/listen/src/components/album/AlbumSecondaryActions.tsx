import { CRATE_ICON_SIZE, Radio, Share2 } from "@crate/ui/icons";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";

import { BandcampSupportButton } from "@/components/bandcamp/BandcampSupportButton";
import { AlbumDesktopMenuAction } from "@/components/album/AlbumDesktopMenuAction";
import { AlbumOfflineAction } from "@/components/album/AlbumOfflineAction";
import type {
  AlbumActionData,
  AlbumActionHandlers,
  AlbumActionMenu,
  AlbumActionState,
} from "@/components/album/album-action-types";
import { SECONDARY_ACTION_CLASS } from "@/components/album/album-action-types";
import { cn } from "@/lib/utils";

export function AlbumSecondaryActions({
  data,
  coverUrl,
  displayName,
  state,
  menu,
  actions,
  t,
}: AlbumActionData & {
  state: AlbumActionState;
  menu: AlbumActionMenu;
  actions: AlbumActionHandlers;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div
      role="group"
      aria-label={t("album.actions.secondaryGroup")}
      className="grid grid-cols-5 items-start gap-2 md:ml-auto md:flex md:shrink-0 md:items-center md:gap-4"
    >
      {!state.isPreRelease ? (
        <button
          className={SECONDARY_ACTION_CLASS}
          onClick={actions.onAlbumRadio}
          aria-label={t("album.actions.radio")}
        >
          <Radio size={CRATE_ICON_SIZE.lg} />
          <span>Radio</span>
        </button>
      ) : null}
      <AlbumOfflineAction state={state} actions={actions} t={t} />
      {state.canSaveAlbum ? (
        <FollowHeartButton
          className={cn(
            SECONDARY_ACTION_CLASS,
            state.saved
              ? "text-accent-action drop-shadow-accent-action"
              : "text-text-primary/62",
          )}
          onClick={actions.onToggleSaved}
          aria-label={
            state.saved
              ? t("album.actions.removeFromCollection")
              : t("album.actions.addToCollection")
          }
          following={state.saved}
          iconSize={CRATE_ICON_SIZE.lg}
        >
          <span>{state.saved ? t("common.added") : t("common.add")}</span>
        </FollowHeartButton>
      ) : null}
      <button
        className={SECONDARY_ACTION_CLASS}
        onClick={actions.onShare}
        aria-label={t("common.share")}
      >
        <Share2 size={CRATE_ICON_SIZE.lg} />
        <span>{t("common.share")}</span>
      </button>
      <BandcampSupportButton
        entityType="album"
        entityUid={data.entity_uid}
        fallbackArtistEntityUid={data.artist_entity_uid}
        presentation="secondary-action"
      />
      <AlbumDesktopMenuAction
        data={data}
        coverUrl={coverUrl}
        displayName={displayName}
        state={state}
        menu={menu}
        actions={actions}
        t={t}
      />
    </div>
  );
}
