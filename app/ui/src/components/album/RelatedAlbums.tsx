import { useApi } from "@/hooks/use-api";
import { useNavigate } from "react-router";
import { ArrowUpRight, Music } from "lucide-react";

import { CrateChip } from "@crate/ui/primitives/CrateBadge";
import { albumCoverApiUrl, albumPagePath, albumRelatedApiPath } from "@/lib/library-routes";

interface RelatedAlbum {
  id?: number;
  slug?: string;
  name: string;
  display_name: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  year: string | null;
  track_count: number;
  has_cover: boolean;
  reason: string;
}

const REASON_LABELS: Record<string, string> = {
  same_artist: "Same Artist",
  genre_decade: "Similar Genre",
  audio_similar: "Similar Sound",
};

export function RelatedAlbums({ albumId }: { albumId?: number }) {
  const { data } = useApi<RelatedAlbum[]>(albumId != null ? albumRelatedApiPath({ albumId }) : null);
  const navigate = useNavigate();

  if (!data || data.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/70">Related Albums</h3>
        <span className="text-[11px] uppercase tracking-[0.16em] text-white/30">Editorial context</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {data.map((album, index) => (
          <button
            key={`${album.artist}-${album.name}-${index}`}
            onClick={() => navigate(albumPagePath({ albumId: album.id, albumSlug: album.slug, artistName: album.artist, albumName: album.name }))}
            className="group w-[148px] flex-shrink-0 rounded-md p-2 text-left transition-colors hover:bg-white/5"
          >
            <div className="relative mb-2 h-[148px] w-[148px] overflow-hidden rounded-md bg-white/5">
              <img
                src={albumCoverApiUrl({ albumId: album.id, albumSlug: album.slug, artistName: album.artist, albumName: album.name })}
                alt={album.display_name}
                loading="lazy"
                className="h-full w-full object-cover"
                onError={(event) => { (event.target as HTMLImageElement).style.display = "none"; }}
              />
              <div className="absolute inset-0 -z-10 flex items-center justify-center bg-white/5">
                <Music size={28} className="text-muted-foreground/30" />
              </div>
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <ArrowUpRight size={20} className="text-white" />
              </div>
            </div>
            <div className="truncate text-xs font-medium text-white/90">{album.display_name}</div>
            <div className="truncate text-[11px] text-white/45">{album.artist}</div>
            <div className="mt-1.5">
              <CrateChip>{REASON_LABELS[album.reason] || album.reason}</CrateChip>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
