import type { RefObject } from "react";
import { Play, Shuffle } from "@crate/ui/icons";

export function AlbumPrimaryActions({
  playerTracksAvailable,
  primaryRef,
  onPlay,
  onShuffle,
  t,
}: {
  playerTracksAvailable: boolean;
  primaryRef: RefObject<HTMLDivElement | null>;
  onPlay: () => void;
  onShuffle: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div
      data-testid="album-primary-actions"
      ref={primaryRef}
      role="group"
      aria-label={t("album.actions.primaryGroup")}
      className="grid grid-cols-2 gap-3 md:flex md:shrink-0 md:items-center md:gap-3"
    >
      <button
        className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-accent-action px-5 text-sm font-semibold text-accent-action-foreground shadow-action-solid transition-[background-color,box-shadow] hover:bg-accent-action/90 hover:shadow-action-solid-hover disabled:cursor-not-allowed disabled:opacity-45 md:px-7 md:text-[0.9375rem]"
        onClick={onPlay}
        disabled={!playerTracksAvailable}
        aria-label={t("player.play")}
      >
        <Play size={17} fill="currentColor" />
        <span>{t("player.play")}</span>
      </button>
      <button
        className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-text-primary/[0.08] px-5 text-sm font-semibold text-text-primary shadow-control-inset transition-[background-color,color,filter,transform] hover:-translate-y-px hover:bg-text-primary/[0.12] hover:text-accent-action hover:drop-shadow-accent-action disabled:cursor-not-allowed disabled:opacity-45 md:w-auto md:px-7"
        onClick={onShuffle}
        disabled={!playerTracksAvailable}
        aria-label={t("player.shuffle")}
      >
        <Shuffle size={17} />
        <span>{t("player.shuffle")}</span>
      </button>
    </div>
  );
}
