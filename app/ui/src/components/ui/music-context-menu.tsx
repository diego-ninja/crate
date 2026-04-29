import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { albumPagePath, artistActionApiPath, artistPagePath } from "@/lib/library-routes";
import { toast } from "sonner";
import { Radar } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@crate/ui/shadcn/context-menu";

interface MusicContextMenuProps {
  children: React.ReactNode;
  type: "album" | "track" | "artist";
  artist: string;
  artistId?: number;
  artistEntityUid?: string;
  artistSlug?: string;
  album?: string;
  albumId?: number;
  albumEntityUid?: string;
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
  artistEntityUid,
  artistSlug,
  album,
  albumId,
  albumSlug,
  onFindSimilar,
}: MusicContextMenuProps) {
  const navigate = useNavigate();

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48 bg-card border-border">
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
            Open Album
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
                  const endpoint = artistActionApiPath({ artistId, artistEntityUid }, "enrich");
                  if (!endpoint) throw new Error("artist reference missing");
                  await api(endpoint, "POST");
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
