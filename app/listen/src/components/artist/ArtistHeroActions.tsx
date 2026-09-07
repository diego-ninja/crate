import { useTranslation } from "react-i18next";

import {
  CRATE_ICON_SIZE,
  ListMusic,
  Play,
  Radio,
  Share2,
  Shuffle,
} from "@crate/ui/icons";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";

import { BandcampSupportButton } from "@/components/bandcamp/BandcampSupportButton";
import { ArtistHeroMenu } from "@/components/artist/ArtistHeroMenu";
import type { ArtistData } from "@/components/artist/artist-model";

interface ArtistHeroActionsProps {
  artist: ArtistData;
  photoUrl: string;
  following: boolean;
  hasSetlist?: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  onArtistRadio: () => void;
  onPlaySetlist?: () => void;
  onToggleFollow: () => void;
  onShare: () => void;
}

const SECONDARY_ACTION_CLASS =
  "flex min-h-14 min-w-[56px] shrink-0 touch-manipulation flex-col items-center justify-center gap-1 px-1.5 py-1 text-xs font-medium text-text-primary/62 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:drop-shadow-none";

export function ArtistHeroActions({
  artist,
  photoUrl,
  following,
  hasSetlist,
  onPlay,
  onShuffle,
  onArtistRadio,
  onPlaySetlist,
  onToggleFollow,
  onShare,
}: ArtistHeroActionsProps) {
  const { t } = useTranslation();

  return (
    <div className="p-4  sm:px-0">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-6">
        <div
          role="group"
          aria-label={t("artist.actions.primaryGroup")}
          className="grid grid-cols-2 gap-3 md:flex md:shrink-0 md:items-center md:gap-3"
        >
          <button
            type="button"
            className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-accent-action px-5 text-sm font-semibold text-accent-action-foreground shadow-action-solid transition-[background-color,box-shadow] hover:bg-accent-action/90 hover:shadow-action-solid-hover md:px-7 md:text-[0.9375rem]"
            onClick={onPlay}
            aria-label={t("player.play")}
          >
            <Play size={17} fill="currentColor" />
            <span>{t("player.play")}</span>
          </button>
          <button
            type="button"
            className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-text-primary/[0.08] px-5 text-sm font-semibold text-text-primary shadow-control-inset transition-[background-color,color,filter,transform] hover:-translate-y-px hover:bg-text-primary/[0.12] hover:text-accent-action hover:drop-shadow-accent-action md:w-auto md:px-7"
            onClick={onShuffle}
            aria-label={t("player.shuffle")}
          >
            <Shuffle size={17} />
            <span>{t("player.shuffle")}</span>
          </button>
        </div>

        <div
          role="group"
          aria-label={t("artist.actions.secondaryGroup")}
          className="grid grid-cols-5 items-start gap-2 md:ml-auto md:flex md:shrink-0 md:items-center md:gap-4"
        >
          <button
            type="button"
            className={SECONDARY_ACTION_CLASS}
            onClick={onArtistRadio}
            aria-label={t("artist.actions.radio")}
          >
            <Radio size={CRATE_ICON_SIZE.lg} />
            <span>Radio</span>
          </button>
          <button
            type="button"
            className={SECONDARY_ACTION_CLASS}
            onClick={onPlaySetlist}
            disabled={!hasSetlist}
            aria-label={t("artist.actions.setlist")}
          >
            <ListMusic size={CRATE_ICON_SIZE.lg} />
            <span>{t("artist.actions.setlist")}</span>
          </button>
          <FollowHeartButton
            className={`${SECONDARY_ACTION_CLASS} ${
              following
                ? "text-accent-action drop-shadow-accent-action"
                : "text-text-primary/62"
            }`}
            following={following}
            iconSize={CRATE_ICON_SIZE.lg}
            onClick={onToggleFollow}
            aria-label={following ? t("common.unfollow") : t("common.follow")}
          >
            <span>
              {following ? t("common.following") : t("common.follow")}
            </span>
          </FollowHeartButton>
          <button
            type="button"
            className={SECONDARY_ACTION_CLASS}
            onClick={onShare}
            aria-label={t("common.share")}
          >
            <Share2 size={CRATE_ICON_SIZE.lg} />
            <span>{t("common.share")}</span>
          </button>
          <BandcampSupportButton
            entityType="artist"
            entityUid={artist.entity_uid}
            presentation="secondary-action"
          />
          <ArtistHeroMenu
            artist={artist}
            photoUrl={photoUrl}
            following={following}
            hasSetlist={hasSetlist}
            onPlay={onPlay}
            onShuffle={onShuffle}
            onArtistRadio={onArtistRadio}
            onPlaySetlist={onPlaySetlist}
            onToggleFollow={onToggleFollow}
            onShare={onShare}
          />
        </div>
      </div>
    </div>
  );
}
