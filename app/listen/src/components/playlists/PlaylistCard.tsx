import { useState } from "react";
import { Heart, Loader2, Play } from "lucide-react";

import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";

interface PlaylistCardProps {
  name: string;
  description?: string;
  tracks?: PlaylistArtworkTrack[];
  coverDataUrl?: string | null;
  meta: string;
  badge?: string;
  systemPlaylist?: boolean;
  isFollowed?: boolean;
  onClick: () => void;
  onPlay?: () => Promise<void> | void;
  onToggleFollow?: () => Promise<void> | void;
}

export function PlaylistCard({
  name,
  description,
  tracks,
  coverDataUrl,
  meta,
  badge,
  systemPlaylist = false,
  isFollowed = false,
  onClick,
  onPlay,
  onToggleFollow,
}: PlaylistCardProps) {
  const [playing, setPlaying] = useState(false);
  const [togglingFollow, setTogglingFollow] = useState(false);

  return (
    <button
      onClick={onClick}
      className="group w-[160px] flex-shrink-0 text-left"
    >
      <div className="relative mb-2 overflow-hidden rounded-lg bg-white/5">
        <PlaylistArtwork
          name={name}
          coverDataUrl={coverDataUrl}
          tracks={tracks}
          className="aspect-square rounded-lg transition-transform group-hover:scale-[1.02]"
        />
        {systemPlaylist && onToggleFollow ? (
          <button
            className="absolute top-2 right-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/55 text-white/75 backdrop-blur-md opacity-0 transition-colors group-hover:opacity-100 hover:bg-black/70 hover:text-white"
            onClick={async (event) => {
              event.stopPropagation();
              setTogglingFollow(true);
              try {
                await onToggleFollow();
              } finally {
                setTogglingFollow(false);
              }
            }}
          >
            {togglingFollow ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Heart size={16} className={isFollowed ? "fill-primary text-primary" : ""} />
            )}
          </button>
        ) : null}
        {onPlay ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
            <button
              className="flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-primary opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100"
              onClick={async (event) => {
                event.stopPropagation();
                setPlaying(true);
                try {
                  await onPlay();
                } finally {
                  setPlaying(false);
                }
              }}
            >
              {playing ? (
                <Loader2 size={18} className="animate-spin text-primary-foreground" />
              ) : (
                <Play size={18} fill="#0a0a0f" className="ml-0.5 text-primary-foreground" />
              )}
            </button>
          </div>
        ) : null}
        {badge ? (
          <div className="absolute left-2 top-2 rounded-full border border-primary/20 bg-[var(--gradient-bg-85)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary backdrop-blur-md">
            {badge}
          </div>
        ) : null}
      </div>
      <div className="truncate text-sm font-medium text-foreground">{name}</div>
      <div className="truncate text-xs text-muted-foreground">
        {description || meta}
      </div>
    </button>
  );
}
