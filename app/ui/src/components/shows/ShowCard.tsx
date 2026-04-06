import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { artistBackgroundApiUrl, artistPagePath } from "@/lib/library-routes";
import {
  MapPin, Calendar, Clock, Ticket, ExternalLink,
} from "lucide-react";
import { ArtistAvatar, ArtistAvatarStack } from "@/components/artist/ArtistAvatar";

interface ShowArtistRef {
  name: string;
  id?: number;
  slug?: string;
}

export interface ShowEvent {
  id: string;
  name: string;
  date: string;
  local_date: string;
  local_time: string;
  venue: string;
  address_line1?: string;
  city: string;
  region: string;
  country: string;
  country_code: string;
  url: string;
  image: string;
  lineup: string[];
  price_range?: { min: number; max: number; currency: string } | null;
  status: string;
  latitude?: string;
  longitude?: string;
  artist_name?: string;
  artist_id?: number;
  artist_slug?: string;
  lineup_artists?: ShowArtistRef[];
  artist_listeners?: number;
  artist_genres?: string[];
}

function getArtistLink(artist: ShowArtistRef | null | undefined) {
  if (!artist || artist.id == null) return undefined;
  return artistPagePath({ artistId: artist.id, artistSlug: artist.slug, artistName: artist.name });
}

const GENRE_COLORS: Record<string, string> = {
  "metal": "#1f2937",
  "heavy metal": "#1f2937",
  "death metal": "#1f2937",
  "black metal": "#1f2937",
  "doom metal": "#374151",
  "punk": "#dc2626",
  "hardcore": "#dc2626",
  "hardcore punk": "#dc2626",
  "post-hardcore": "#ea580c",
  "grindcore": "#991b1b",
  "rock": "#2563eb",
  "alternative rock": "#3b82f6",
  "indie rock": "#6366f1",
  "grunge": "#4b5563",
  "post-punk": "#7c3aed",
  "shoegaze": "#a78bfa",
  "electronic": "#06b6d4",
  "ambient": "#0e7490",
  "noise": "#78716c",
  "experimental": "#a855f7",
  "math rock": "#14b8a6",
  "emo": "#f43f5e",
  "screamo": "#e11d48",
  "hip hop": "#eab308",
  "jazz": "#f59e0b",
  "folk": "#65a30d",
};

export function getGenreColor(genres?: string[]): string {
  if (!genres || genres.length === 0) return "#06b6d4"; // default cyan
  for (const g of genres) {
    const lower = g.toLowerCase();
    if (GENRE_COLORS[lower]) return GENRE_COLORS[lower];
    // partial match
    for (const [key, color] of Object.entries(GENRE_COLORS)) {
      if (lower.includes(key) || key.includes(lower)) return color;
    }
  }
  return "#06b6d4";
}

/** Compact inline trigger for calendar cells */
function CompactCard({ show }: { show: ShowEvent }) {
  return (
    <div className="flex items-center gap-2 text-xs py-1 px-1.5 rounded hover:bg-white/5 cursor-pointer min-w-0">
      <ArtistAvatarStack names={show.lineup.length > 0 ? show.lineup.slice(0, 2) : (show.artist_name ? [show.artist_name] : [])} size={18} />
      <span className="font-medium truncate">{show.artist_name || show.lineup[0] || show.name}</span>
      <span className="text-muted-foreground truncate hidden sm:inline">{show.venue}</span>
    </div>
  );
}

/** Full show card */
export function ShowCard({ show, compact }: { show: ShowEvent; compact?: boolean }) {
  if (compact) return <CompactCard show={show} />;

  const d = show.date ? new Date(show.date) : null;
  const dateStr = d
    ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : show.local_date;
  const timeStr = show.local_time
    ? show.local_time.slice(0, 5)
    : d ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
  const location = [show.city, show.region, show.country].filter(Boolean).join(", ");

  // Headliner = first in Ticketmaster lineup, support = rest
  const allArtists: ShowArtistRef[] = show.lineup_artists && show.lineup_artists.length > 0
    ? show.lineup_artists
    : show.lineup.length > 0
      ? show.lineup.map((name) => ({ name }))
      : (show.artist_name ? [{ name: show.artist_name, id: show.artist_id, slug: show.artist_slug }] : []);
  const headliner = allArtists[0];
  const support = allArtists.slice(1);
  const backgroundUrl = artistBackgroundApiUrl({ artistId: headliner?.id, artistSlug: headliner?.slug, artistName: headliner?.name });
  const headlinerHref = getArtistLink(headliner);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden w-[340px] shadow-xl">
      {/* Header image */}
      <div className="relative h-[100px] bg-secondary">
        {show.image ? (
          <img src={show.image} alt="" className="w-full h-full object-cover" />
        ) : backgroundUrl ? (
          <img
            src={backgroundUrl}
            alt=""
            className="w-full h-full object-cover opacity-60"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : null}

        {/* Lineup avatars — stacked, bottom-left */}
        <div className="absolute -bottom-4 left-4 flex -space-x-2">
          {allArtists.slice(0, 4).map((artist) => (
            <ArtistAvatar key={`${artist.name}-${artist.id ?? "external"}`} name={artist.name} artistId={artist.id} artistSlug={artist.slug} size={36} linked />
          ))}
        </div>

        {show.status === "onsale" && (
          <Badge className="absolute top-2 right-2 bg-green-500/90 text-white text-[10px] border-0">
            On Sale
          </Badge>
        )}
      </div>

      {/* Content */}
      <div className="p-4 pt-6 space-y-2">
        {/* Headliner + support */}
        <div>
          {headlinerHref ? (
            <Link
              to={headlinerHref}
              className="block font-bold text-lg text-foreground hover:text-primary transition-colors truncate"
            >
              {headliner?.name}
            </Link>
          ) : (
            <div className="font-bold text-lg text-foreground truncate">
              {headliner?.name}
            </div>
          )}
          {support.length > 0 && (
            <div className="text-xs text-muted-foreground truncate">
              {support.slice(0, 4).map((artist, i) => (
                <span key={`${artist.name}-${artist.id ?? "external"}`}>
                  {i > 0 && <span> &middot; </span>}
                  {getArtistLink(artist) ? (
                    <Link to={getArtistLink(artist)!} className="hover:text-foreground transition-colors">{artist.name}</Link>
                  ) : (
                    <span>{artist.name}</span>
                  )}
                </span>
              ))}
              {support.length > 4 && <span> +{support.length - 4} more</span>}
            </div>
          )}
          {show.name && show.name.toLowerCase() !== (headliner?.name || "").toLowerCase() && (
            <div className="text-[11px] text-muted-foreground/60 truncate mt-0.5">{show.name}</div>
          )}
        </div>

        {/* Venue card */}
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 space-y-2">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <MapPin size={12} className="flex-shrink-0 mt-0.5 text-primary/70" />
            <div>
              <div className="text-foreground font-medium">{show.venue}</div>
              {show.address_line1 && <div>{show.address_line1}</div>}
              <div>{location}</div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Calendar size={11} className="text-primary/70" />{dateStr}</span>
            {timeStr && <span className="flex items-center gap-1"><Clock size={11} className="text-primary/70" />{timeStr}</span>}
          </div>
          {show.price_range && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Ticket size={11} className="text-primary/70" />
              <span>{show.price_range.min}–{show.price_range.max} {show.price_range.currency}</span>
            </div>
          )}
        </div>

        {/* Ticketmaster link */}
        <a
          href={show.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-xs font-medium"
        >
          <ExternalLink size={12} /> View on Ticketmaster
        </a>
      </div>
    </div>
  );
}
