import { memo, useState } from "react";
import { useNavigate } from "react-router";
import { Heart, Loader2, Play } from "lucide-react";

import { ItemActionMenu, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { useAlbumActionEntries } from "@/components/actions/album-actions";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useSavedAlbums } from "@/contexts/SavedAlbumsContext";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { albumApiPath, albumCoverApiUrl, albumPagePath } from "@/lib/library-routes";

interface AlbumCardProps {
  artist: string;
  album: string;
  albumId?: number;
  albumSlug?: string;
  year?: string;
  cover?: string;
  compact?: boolean;
  layout?: "rail" | "grid";
}

interface AlbumData {
  artist: string;
  name: string;
  display_name: string;
  tracks: Array<{
    id: number;
    storage_id?: string;
    filename: string;
    path: string;
    length_sec: number;
    tags: {
      title: string;
    };
  }>;
}

export const AlbumCard = memo(function AlbumCard({
  artist,
  album,
  albumId,
  albumSlug,
  year,
  cover,
  compact,
  layout = "rail",
}: AlbumCardProps) {
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const { isSaved, toggleAlbumSaved } = useSavedAlbums();
  const [playing, setPlaying] = useState(false);
  const coverUrl = cover || albumCoverApiUrl({ albumId, albumSlug, artistName: artist, albumName: album });
  const saved = isSaved(albumId);
  const actions = useAlbumActionEntries({
    artist,
    album,
    albumId,
    albumSlug,
    cover: coverUrl,
  });
  const actionMenu = useItemActionMenu(actions, { disabled: albumId == null });

  async function handlePlayOverlay(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setPlaying(true);
    try {
      const data = await api<AlbumData>(albumApiPath({ albumId, albumSlug, artistName: artist, albumName: album }));
      const playerTracks: Track[] = (data.tracks || []).map((track) => ({
        id: track.storage_id || track.path || String(track.id),
        storageId: track.storage_id,
        title: track.tags?.title || track.filename || "Unknown",
        artist: data.artist,
        album: data.display_name || data.name,
        albumCover: coverUrl,
        path: track.path,
        libraryTrackId: track.id,
      }));
      if (playerTracks.length > 0) {
        playAll(playerTracks, 0, {
          type: "album",
          name: `${artist} - ${album}`,
          radio: albumId != null ? { seedType: "album", seedId: albumId } : undefined,
        });
      }
    } finally {
      setPlaying(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group snap-start cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-lg",
        layout === "grid"
          ? "w-full min-w-0"
          : `flex-shrink-0 ${compact ? "w-[120px]" : "w-[160px]"}`,
      )}
      onContextMenu={actionMenu.handleContextMenu}
      {...actionMenu.longPressHandlers}
      onClick={() => navigate(albumPagePath({ albumId, albumSlug, artistName: artist, albumName: album }))}
      onKeyDown={(event) => {
        actionMenu.handleKeyboardTrigger(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(albumPagePath({ albumId, albumSlug, artistName: artist, albumName: album }));
        }
      }}
    >
      <div className="relative aspect-square rounded-lg overflow-hidden bg-white/5 mb-2">
        <img
          src={coverUrl}
          alt={album}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        {albumId != null && (
          <ActionIconButton
            variant="card"
            active={saved}
            className={`absolute top-2 right-2 z-10 ${saved ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            onClick={async (event) => {
              event.stopPropagation();
              try {
                await toggleAlbumSaved(albumId);
              } catch {
                // no-op; page-level toasts can be added later
              }
            }}
          >
            <Heart size={16} className={saved ? "fill-current" : ""} />
          </ActionIconButton>
        )}
        <div className="absolute inset-0 hidden bg-black/0 transition-colors md:flex md:items-center md:justify-center md:p-0 md:group-hover:bg-black/40">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary opacity-0 shadow-lg transition-all md:translate-y-2 md:group-hover:translate-y-0 md:group-hover:opacity-100"
            onClick={handlePlayOverlay}
          >
            {playing ? (
              <Loader2 size={18} className="text-primary-foreground animate-spin" />
            ) : (
              <Play size={18} fill="#0a0a0f" className="text-primary-foreground ml-0.5" />
            )}
          </button>
        </div>
      </div>
      <div className="truncate text-sm font-medium text-foreground">{album}</div>
      <div className="truncate text-xs text-muted-foreground">
        {year ? `${year} · ${artist}` : artist}
      </div>
      <ItemActionMenu
        actions={actions}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
});
