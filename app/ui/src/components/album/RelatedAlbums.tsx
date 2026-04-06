import { useApi } from "@/hooks/use-api";
import { useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Music, Play } from "lucide-react";
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
      <h3 className="font-semibold mb-3">You Might Also Like</h3>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {data.map((a, i) => (
          <button
            key={`${a.artist}-${a.name}-${i}`}
            onClick={() => navigate(albumPagePath({ albumId: a.id, albumSlug: a.slug, artistName: a.artist, albumName: a.name }))}
            className="flex-shrink-0 w-[140px] group text-left"
          >
            <div className="relative w-[140px] h-[140px] rounded-lg overflow-hidden bg-secondary mb-2">
              <img
                src={albumCoverApiUrl({ albumId: a.id, albumSlug: a.slug, artistName: a.artist, albumName: a.name })}
                alt={a.display_name}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <div className="absolute inset-0 bg-secondary flex items-center justify-center -z-10">
                <Music size={28} className="text-muted-foreground/30" />
              </div>
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Play size={20} className="text-white fill-white" />
              </div>
            </div>
            <div className="text-xs font-medium truncate">{a.display_name}</div>
            <div className="text-[11px] text-muted-foreground truncate">{a.artist}</div>
            <Badge variant="outline" className="text-[9px] px-1 py-0 mt-0.5">
              {REASON_LABELS[a.reason] || a.reason}
            </Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
