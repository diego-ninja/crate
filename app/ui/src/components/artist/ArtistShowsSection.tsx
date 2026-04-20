import { Badge } from "@/components/ui/badge";
import { artistPhotoApiUrl } from "@/lib/library-routes";
import { ExternalLink, MapPin } from "lucide-react";

interface ShowPriceRange {
  min: number;
  max: number;
  currency: string;
}

export interface ArtistShowEvent {
  id: string;
  artist_id?: number;
  artist_slug?: string;
  name: string;
  date: string;
  local_date: string;
  venue: string;
  city: string;
  region: string;
  country: string;
  country_code: string;
  url: string;
  image: string;
  lineup: string[];
  price_range?: ShowPriceRange | null;
  status: string;
}

interface ArtistShowsSectionProps {
  artistName: string;
  artistId?: number;
  artistSlug?: string;
  shows: ArtistShowEvent[];
}

export function ArtistShowsSection({ artistName, artistId, artistSlug, shows }: ArtistShowsSectionProps) {
  return (
    <div className="space-y-1">
      {shows.map((show, i) => {
        const dateObj = show.date ? new Date(show.date + (show.date.includes("T") ? "" : "T12:00:00")) : null;
        const dateStr = dateObj ? dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : show.local_date;
        const location = [show.city, show.country].filter(Boolean).join(", ");
        return (
          <a
            key={show.id || i}
            href={show.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 p-3 rounded-md border border-amber-500/10 hover:border-amber-500/20 transition-all hover:bg-card/80 group"
          >
            <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-secondary">
              <img
                src={artistPhotoApiUrl({ artistId, artistSlug, artistName })}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{show.name || show.venue}</span>
              </div>
              <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                <MapPin size={10} className="text-amber-400/60 flex-shrink-0" />
                <span>{show.venue}</span>
                <span className="text-muted-foreground/40">&middot;</span>
                <span>{location}</span>
              </div>
              {show.lineup.length > 1 && (
                <div className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">
                  with {show.lineup.filter((lineupArtist) => lineupArtist.toLowerCase() !== artistName.toLowerCase()).join(", ")}
                </div>
              )}
            </div>

            <div className="text-right flex-shrink-0 text-amber-400">
              <div className="text-xs font-semibold">{dateStr}</div>
              {show.price_range && (
                <div className="text-[10px] text-muted-foreground">
                  {show.price_range.min}–{show.price_range.max} {show.price_range.currency}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              {show.status === "onsale" && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/30 text-amber-400">
                  On Sale
                </Badge>
              )}
              <span className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-amber-500/10">
                <ExternalLink size={14} className="text-amber-400" />
              </span>
            </div>
          </a>
        );
      })}
    </div>
  );
}
