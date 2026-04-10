import { useState } from "react";
import { useNavigate } from "react-router";
import { Heart, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ItemActionMenu, ItemActionMenuButton, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { useArtistActionEntries } from "@/components/actions/artist-actions";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { useArtistFollows } from "@/contexts/ArtistFollowsContext";
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
}: ArtistCardProps) {
  const navigate = useNavigate();
  const { isFollowing, toggleArtistFollow } = useArtistFollows();
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
    "group snap-start cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-lg",
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
          maxWidth: imageSize,
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
            <ActionIconButton
              variant="card"
              active={following}
              className={cn(
                "absolute right-2 top-2 z-10 pointer-events-auto",
                following ? "opacity-100" : "opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100",
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
              title={following ? "Following" : "Follow"}
            >
              {togglingFollow ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Heart size={16} className={following ? "fill-current" : ""} />
              )}
            </ActionIconButton>
            <ItemActionMenuButton
              buttonRef={actionMenu.triggerRef}
              hasActions={actionMenu.hasActions}
              onClick={actionMenu.openFromTrigger}
              className="absolute bottom-2 right-2 z-10 pointer-events-auto opacity-80 transition-opacity hover:opacity-100 md:opacity-65 md:group-hover:opacity-100"
            />
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
      onClick={() => navigate(targetHref)}
      onKeyDown={(event) => {
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
