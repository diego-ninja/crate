import { useNavigate } from "react-router";
import { usePlayer } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { albumCoverApiUrl, albumPagePath, artistPagePath } from "@/lib/library-routes";
import { toast } from "sonner";
import { Radar } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface MusicContextMenuProps {
  children: React.ReactNode;
  type: "album" | "track" | "artist";
  artist: string;
  artistId?: number;
  artistSlug?: string;
  album?: string;
  albumId?: number;
  albumSlug?: string;
  trackId?: string;
  trackTitle?: string;
  albumCover?: string;
  onFindSimilar?: () => void;
}



export function MusicContextMenu({
  children,
  type,
  artist,
  artistId,
  artistSlug,
  album,
  albumId,
  albumSlug,
  trackId,
  trackTitle,
  albumCover,
  onFindSimilar,
}: MusicContextMenuProps) {
  const navigate = useNavigate();
  const { play, playNext, addToQueue } = usePlayer();
  const resolvedAlbumCover = albumCover || albumCoverApiUrl({
    albumId,
    albumSlug,
    artistName: artist,
    albumName: album,
  }) || undefined;

  async function handlePlay() {
    if (type === "track" && trackId) {
      play({
        id: trackId,
        title: trackTitle || "",
        artist,
        artistId,
        artistSlug,
        album,
        albumId,
        albumSlug,
        albumCover: resolvedAlbumCover,
      });
      return;
    }
    if (type === "album" && album) {
      navigate(albumPagePath({ albumId, albumSlug, artistName: artist, albumName: album }));
    }
  }

  function handlePlayNext() {
    if (type === "track" && trackId) {
      playNext({
        id: trackId,
        title: trackTitle || "",
        artist,
        artistId,
        artistSlug,
        album,
        albumId,
        albumSlug,
        albumCover: resolvedAlbumCover,
      });
      toast.success("Playing next");
    }
  }

  function handleAddToQueue() {
    if (type === "track" && trackId) {
      addToQueue({
        id: trackId,
        title: trackTitle || "",
        artist,
        artistId,
        artistSlug,
        album,
        albumId,
        albumSlug,
        albumCover: resolvedAlbumCover,
      });
      toast.success("Added to queue");
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48 bg-card border-border">
        {(type === "track" || type === "album") && (
          <>
            <ContextMenuItem onClick={handlePlay} className="text-sm">
              Play
            </ContextMenuItem>
            <ContextMenuItem onClick={handlePlayNext} className="text-sm">
              Play Next
            </ContextMenuItem>
            <ContextMenuItem onClick={handleAddToQueue} className="text-sm">
              Add to Queue
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {type !== "artist" && (
          <ContextMenuItem
            onClick={() => navigate(artistPagePath({ artistId, artistSlug, artistName: artist }))}
            className="text-sm"
          >
            Go to Artist
          </ContextMenuItem>
        )}
        {type === "track" && album && (
          <ContextMenuItem
            onClick={() => navigate(albumPagePath({ albumId, albumSlug, artistName: artist, albumName: album }))}
            className="text-sm"
          >
            Go to Album
          </ContextMenuItem>
        )}
        {type === "album" && album && (
          <ContextMenuItem
            onClick={() => navigate(albumPagePath({ albumId, albumSlug, artistName: artist, albumName: album }))}
            className="text-sm"
          >
            Open Album
          </ContextMenuItem>
        )}
        {type === "track" && onFindSimilar && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onFindSimilar} className="text-sm">
              <Radar size={14} className="mr-2" /> Find Similar
            </ContextMenuItem>
          </>
        )}
        {artistId != null && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={async () => {
                try {
                  await api(`/api/artists/${artistId}/enrich`, "POST");
                  toast.success("Enrichment started");
                } catch {
                  toast.error("Failed to start enrichment");
                }
              }}
              className="text-sm"
            >
              Enrich Artist
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
