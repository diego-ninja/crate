import { useState } from "react";
import { useNavigate } from "react-router";
import { Heart, Loader2, Play, Share2, Shuffle, Sparkles, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { encPath } from "@/lib/utils";

interface PlaylistTrackResponse {
  track_id?: number;
  track_path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  navidrome_id?: string;
}

interface PlaylistDetailResponse {
  tracks: PlaylistTrackResponse[];
}

interface PlaylistListRowProps {
  playlistId?: number;
  name: string;
  description?: string;
  coverDataUrl?: string | null;
  artworkTracks?: PlaylistArtworkTrack[];
  trackCount: number;
  meta?: string;
  href: string;
  detailEndpoint: string;
  badge?: "smart" | "curated" | "personal";
  followState?: {
    isFollowed: boolean;
    onToggle: () => Promise<void>;
  };
  extraActions?: Array<{
    key: string;
    icon: LucideIcon;
    title: string;
    onClick: () => void | Promise<void>;
    loading?: boolean;
    tone?: "default" | "danger" | "primary";
  }>;
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

function toPlayerTracks(tracks: PlaylistTrackResponse[]): Track[] {
  return tracks.map((track) => ({
    id: track.track_path,
    title: track.title || "Unknown",
    artist: track.artist || "",
    album: track.album,
    albumCover:
      track.artist && track.album
        ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`
        : undefined,
    path: track.track_path,
    navidromeId: track.navidrome_id,
    libraryTrackId: track.track_id,
  }));
}

export function PlaylistListRow({
  playlistId,
  name,
  description,
  coverDataUrl,
  artworkTracks,
  trackCount,
  meta,
  href,
  detailEndpoint,
  badge,
  followState,
  extraActions,
}: PlaylistListRowProps) {
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const [playingMode, setPlayingMode] = useState<"play" | "shuffle" | null>(null);
  const [sharing, setSharing] = useState(false);
  const [togglingFollow, setTogglingFollow] = useState(false);

  async function loadAndPlay(mode: "play" | "shuffle") {
    setPlayingMode(mode);
    try {
      const response = await api<PlaylistDetailResponse>(detailEndpoint);
      const tracks = toPlayerTracks(response.tracks || []);
      if (tracks.length === 0) {
        toast.message("This playlist has no playable tracks yet");
        return;
      }
      const queue = mode === "shuffle" ? shuffleArray(tracks) : tracks;
      playAll(queue, 0, {
        type: "playlist",
        name,
        radio: playlistId != null ? { seedType: "playlist", seedId: playlistId } : undefined,
      });
    } catch {
      toast.error("Failed to load playlist");
    } finally {
      setPlayingMode(null);
    }
  }

  async function handleShare(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setSharing(true);
    const shareUrl = `${window.location.origin}${href}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: name, text: name, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Playlist link copied");
      }
    } catch {
      toast.error("Failed to share playlist");
    } finally {
      setSharing(false);
    }
  }

  async function handleToggleFollow(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!followState) return;
    setTogglingFollow(true);
    try {
      await followState.onToggle();
    } finally {
      setTogglingFollow(false);
    }
  }

  const badgeLabel =
    badge === "smart" ? "Smart" : badge === "curated" ? "Curated" : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(href);
        }
      }}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-white/5"
    >
      <PlaylistArtwork
        name={name}
        coverDataUrl={coverDataUrl}
        tracks={artworkTracks}
        className="h-12 w-12 flex-shrink-0 rounded-lg"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          {badgeLabel ? (
            <span className="inline-flex items-center rounded-md border border-primary/30 px-1.5 py-0 text-[10px] font-medium text-primary">
              <Sparkles size={10} className="mr-0.5" />
              {badgeLabel}
            </span>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {trackCount} track{trackCount !== 1 ? "s" : ""}
          {meta ? ` · ${meta}` : ""}
        </div>
        {description ? <div className="mt-1 truncate text-[11px] text-white/35">{description}</div> : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={(event) => {
            event.stopPropagation();
            void loadAndPlay("play");
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
          title="Play"
        >
          {playingMode === "play" ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation();
            void loadAndPlay("shuffle");
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
          title="Shuffle"
        >
          {playingMode === "shuffle" ? <Loader2 size={15} className="animate-spin" /> : <Shuffle size={15} />}
        </button>
        {followState ? (
          <button
            onClick={handleToggleFollow}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
              followState.isFollowed
                ? "text-primary hover:bg-primary/10"
                : "text-white/45 hover:bg-white/10 hover:text-white"
            }`}
            title={followState.isFollowed ? "Following" : "Follow"}
          >
            {togglingFollow ? <Loader2 size={15} className="animate-spin" /> : <Heart size={15} className={followState.isFollowed ? "fill-current" : ""} />}
          </button>
        ) : null}
        {extraActions?.map((action) => {
          const Icon = action.icon;
          const toneClass =
            action.tone === "danger"
              ? "text-red-300/80 hover:bg-red-500/10 hover:text-red-300"
              : action.tone === "primary"
                ? "text-cyan-200/80 hover:bg-cyan-400/10 hover:text-cyan-100"
                : "text-white/45 hover:bg-white/10 hover:text-white";

          return (
            <button
              key={action.key}
              onClick={async (event) => {
                event.stopPropagation();
                await action.onClick();
              }}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${toneClass}`}
              title={action.title}
            >
              {action.loading ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
            </button>
          );
        })}
        <button
          onClick={handleShare}
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
          title="Share"
        >
          {sharing ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />}
        </button>
      </div>
    </div>
  );
}
