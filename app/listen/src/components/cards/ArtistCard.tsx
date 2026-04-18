import { useState } from "react";
import { useNavigate } from "react-router";
import { Loader2, Play, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { ItemActionMenu, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { fetchArtistTopTracks } from "@/components/actions/shared";
import { useArtistActionEntries } from "@/components/actions/artist-actions";
import { useArtistFollows } from "@/contexts/ArtistFollowsContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { cn } from "@/lib/utils";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

interface ArtistCardProps {
  name: string;
  artistId?: number;
  artistSlug?: string;
  photo?: string;
  subtitle?: string;
  compact?: boolean;
  href?: string;
  external?: boolean;
  large?: boolean;
  layout?: "rail" | "grid";
  fillGrid?: boolean;
}

export function ArtistCard({
  name,
  artistId,
  artistSlug,
  photo,
  subtitle,
  compact,
  href,
  external = false,
  large = false,
  layout = "rail",
  fillGrid = false,
}: ArtistCardProps) {
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const { isFollowing, toggleArtistFollow } = useArtistFollows();
  const [playingTopTracks, setPlayingTopTracks] = useState(false);
  const [togglingFollow, setTogglingFollow] = useState(false);
  const photoUrl = photo || artistPhotoApiUrl({ artistId, artistSlug, artistName: name }) || undefined;
  const targetHref = href || artistPagePath({ artistId, artistSlug, artistName: name });
  const following = isFollowing(artistId);
  const actions = useArtistActionEntries({
    artistId,
    artistSlug,
    name,
  });
  const actionMenu = useItemActionMenu(actions, { disabled: external || artistId == null });
  const imageSize = compact ? 100 : large ? 156 : 140;
  const wrapperClassName = cn(
    "group snap-start cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-xl",
    layout === "grid"
      ? "w-full min-w-0"
      : `flex-shrink-0 ${compact ? "w-[100px]" : large ? "w-[156px]" : "w-[140px]"}`,
  );
  const content = (
    <>
      <div
        className="relative mx-auto mb-2 aspect-square overflow-hidden rounded-full bg-white/5"
        style={{
          width: layout === "grid" ? "100%" : imageSize,
          maxWidth: layout === "grid" && fillGrid ? "none" : imageSize,
          height: layout === "grid" ? "auto" : imageSize,
        }}
      >
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : null}
        {!external && artistId != null ? (
          <>
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-full bg-black/0 transition-colors group-hover:bg-black/42">
              <div className="pointer-events-none flex translate-y-2 items-center justify-center gap-2 opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100">
                <button
                  type="button"
                  className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
                  onClick={async (event) => {
                    event.stopPropagation();
                    if (artistId == null) return;
                    setPlayingTopTracks(true);
                    try {
                      const tracks = await fetchArtistTopTracks({
                        artistId,
                        artistSlug,
                        name,
                      });
                      if (!tracks.length) {
                        toast.info("No top tracks available for this artist yet");
                        return;
                      }
                      playAll(tracks, 0, { type: "queue", name: `${name} Top Tracks` });
                    } catch {
                      toast.error("Failed to load top tracks");
                    } finally {
                      setPlayingTopTracks(false);
                    }
                  }}
                  aria-label={`Play top tracks from ${name}`}
                  title="Play top tracks"
                >
                  {playingTopTracks ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} fill="currentColor" />
                  )}
                </button>
                <button
                  type="button"
                  className={cn(
                    "pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-lg backdrop-blur-sm",
                    following
                      ? "border-primary/30 bg-primary/15 text-primary"
                      : "border-white/16 bg-black/35 text-white",
                  )}
                  onClick={async (event) => {
                    event.stopPropagation();
                    setTogglingFollow(true);
                    try {
                      await toggleArtistFollow(artistId);
                      toast.success(following ? `Unfollowed ${name}` : `Following ${name}`);
                    } catch {
                      toast.error("Failed to update follow status");
                    } finally {
                      setTogglingFollow(false);
                    }
                  }}
                  aria-label={following ? `Unfollow ${name}` : `Follow ${name}`}
                  title={following ? "Following" : "Follow"}
                >
                  {togglingFollow ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : following ? (
                    <UserMinus size={14} />
                  ) : (
                    <UserPlus size={14} />
                  )}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
      <div className="truncate text-sm font-medium text-foreground text-center">{name}</div>
      {subtitle && (
        <div className="truncate text-xs text-muted-foreground text-center">{subtitle}</div>
      )}
    </>
  );

  if (external) {
    return (
      <a
        href={targetHref}
        target="_blank"
        rel="noopener noreferrer"
        className={wrapperClassName}
      >
        {content}
      </a>
    );
  }

  return (
    <div
      className={wrapperClassName}
      role="button"
      tabIndex={0}
      onContextMenu={actionMenu.handleContextMenu}
      {...actionMenu.longPressHandlers}
      onClick={() => navigate(targetHref)}
      onKeyDown={(event) => {
        actionMenu.handleKeyboardTrigger(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(targetHref);
        }
      }}
    >
      {content}
      <ItemActionMenu
        actions={actions}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}
