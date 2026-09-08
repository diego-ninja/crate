import type { MouseEvent } from "react";
import {
  Heart,
  HeartBold,
  Loader2,
  Play,
  Shuffle,
  type LucideIcon,
} from "@crate/ui/icons";

import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";

export interface PlaylistListRowExtraAction {
  key: string;
  icon: LucideIcon;
  title: string;
  onClick: () => void | Promise<void>;
  loading?: boolean;
  tone?: "default" | "danger" | "primary";
}

export function PlaylistListRowActions({
  extraActions,
  followState,
  onToggleFollow,
  onPlay,
  onShuffle,
  playingMode,
  togglingFollow,
}: {
  extraActions?: PlaylistListRowExtraAction[];
  followState?: { isFollowed: boolean };
  onToggleFollow: (event: MouseEvent<HTMLButtonElement>) => void;
  onPlay: (event: MouseEvent<HTMLButtonElement>) => void;
  onShuffle: (event: MouseEvent<HTMLButtonElement>) => void;
  playingMode: "play" | "shuffle" | null;
  togglingFollow: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <ActionIconButton onClick={onPlay} title="Play">
        {playingMode === "play" ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <Play size={15} fill="currentColor" className="ml-0.5" />
        )}
      </ActionIconButton>
      <ActionIconButton onClick={onShuffle} title="Shuffle">
        {playingMode === "shuffle" ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <Shuffle size={15} />
        )}
      </ActionIconButton>
      {followState ? (
        <ActionIconButton
          onClick={onToggleFollow}
          active={followState.isFollowed}
          title={followState.isFollowed ? "Following" : "Follow"}
        >
          {togglingFollow ? (
            <Loader2 size={15} className="animate-spin" />
          ) : followState.isFollowed ? (
            <HeartBold size={15} />
          ) : (
            <Heart size={15} />
          )}
        </ActionIconButton>
      ) : null}
      {extraActions?.map((action) => {
        const Icon = action.icon;

        return (
          <ActionIconButton
            key={action.key}
            onClick={(event) => {
              event.stopPropagation();
              void action.onClick();
            }}
            tone={action.tone}
            title={action.title}
          >
            {action.loading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Icon size={15} />
            )}
          </ActionIconButton>
        );
      })}
    </div>
  );
}
