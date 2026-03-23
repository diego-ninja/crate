import { useNavigate } from "react-router";
import { usePlayer, type Track } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import { toast } from "sonner";
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
  album?: string;
  trackId?: string;
  trackTitle?: string;
  albumCover?: string;
}

interface NavidromeSong {
  id: string;
  title: string;
  track: number;
  duration: number;
}

interface NavidromeAlbumLink {
  id: string;
  name: string;
  songs: NavidromeSong[];
  navidrome_url: string;
}

export function MusicContextMenu({
  children,
  type,
  artist,
  album,
  trackId,
  trackTitle,
  albumCover,
}: MusicContextMenuProps) {
  const navigate = useNavigate();
  const { play, playAll, playNext, addToQueue } = usePlayer();

  async function handlePlay() {
    if (type === "track" && trackId) {
      play({ id: trackId, title: trackTitle || "", artist, album, albumCover });
      return;
    }
    if (type === "album" && album) {
      try {
        const data = await api<NavidromeAlbumLink>(
          `/api/navidrome/album/${encPath(artist)}/${encPath(album)}/link`,
        );
        if (data?.songs?.length) {
          const coverUrl = `/api/cover/${encPath(artist)}/${encPath(album)}`;
          const tracks: Track[] = data.songs.map((s) => ({
            id: s.id, title: s.title, artist, album, albumCover: coverUrl,
          }));
          playAll(tracks);
        }
      } catch {
        navigate(`/album/${encPath(artist)}/${encPath(album)}`);
      }
    }
  }

  function handlePlayNext() {
    if (type === "track" && trackId) {
      playNext({ id: trackId, title: trackTitle || "", artist, album, albumCover });
      toast.success("Playing next");
    }
  }

  function handleAddToQueue() {
    if (type === "track" && trackId) {
      addToQueue({ id: trackId, title: trackTitle || "", artist, album, albumCover });
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
            onClick={() => navigate(`/artist/${encPath(artist)}`)}
            className="text-sm"
          >
            Go to Artist
          </ContextMenuItem>
        )}
        {type === "track" && album && (
          <ContextMenuItem
            onClick={() =>
              navigate(`/album/${encPath(artist)}/${encPath(album)}`)
            }
            className="text-sm"
          >
            Go to Album
          </ContextMenuItem>
        )}
        {type === "album" && album && (
          <ContextMenuItem
            onClick={() =>
              navigate(`/album/${encPath(artist)}/${encPath(album)}`)
            }
            className="text-sm"
          >
            Open Album
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={async () => {
            try {
              await api(`/api/artist/${encPath(artist)}/enrich`, "POST");
              toast.success("Enrichment started");
            } catch {
              toast.error("Failed to start enrichment");
            }
          }}
          className="text-sm"
        >
          Enrich Artist
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
