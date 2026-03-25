import { Badge } from "@/components/ui/badge";
import { encPath, formatCompact } from "@/lib/utils";
import {
  MapPin, Calendar, Clock, Ticket, ExternalLink, Users,
} from "lucide-react";

export interface ShowEvent {
  id: string;
  name: string;
  date: string;
  local_date: string;
  local_time: string;
  venue: string;
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
  // Added by Shows page when fetching for multiple artists
  artist_name?: string;
  artist_listeners?: number;
}

/** Full show card — used in popups, dialogs, expanded views */
export function ShowCard({ show, compact }: { show: ShowEvent; compact?: boolean }) {
  const d = show.date ? new Date(show.date) : null;
  const dateStr = d
    ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : show.local_date;
  const timeStr = show.local_time
    ? show.local_time.slice(0, 5)
    : d ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
  const location = [show.city, show.country].filter(Boolean).join(", ");
  const otherArtists = show.lineup.filter(
    (l) => show.artist_name && l.toLowerCase() !== show.artist_name.toLowerCase()
  );

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs py-1 px-1.5 rounded hover:bg-white/5 cursor-pointer min-w-0">
        {show.artist_name && (
          <img
            src={`/api/artist/${encPath(show.artist_name)}/photo`}
            alt=""
            className="w-5 h-5 rounded-full object-cover flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
        <span className="font-medium truncate">{show.artist_name || show.name}</span>
        <span className="text-muted-foreground truncate">{show.venue}</span>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden w-[340px] shadow-xl">
      {/* Header with event image or artist photo */}
      <div className="relative h-[100px] bg-secondary">
        {show.image ? (
          <img src={show.image} alt="" className="w-full h-full object-cover" />
        ) : show.artist_name ? (
          <img
            src={`/api/artist/${encPath(show.artist_name)}/background`}
            alt=""
            className="w-full h-full object-cover opacity-60"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />

        {/* Artist photo circle */}
        {show.artist_name && (
          <div className="absolute -bottom-5 left-4">
            <img
              src={`/api/artist/${encPath(show.artist_name)}/photo`}
              alt={show.artist_name}
              className="w-10 h-10 rounded-full object-cover ring-2 ring-card"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
        )}

        {/* Status badge */}
        {show.status === "onsale" && (
          <Badge className="absolute top-2 right-2 bg-green-500/90 text-white text-[10px] border-0">
            On Sale
          </Badge>
        )}
      </div>

      {/* Content */}
      <div className="p-4 pt-7">
        {/* Artist + popularity */}
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm truncate">{show.artist_name || show.name}</span>
          {show.artist_listeners && show.artist_listeners > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 flex-shrink-0">
              {formatCompact(show.artist_listeners)} listeners
            </Badge>
          )}
        </div>

        {/* Event name (if different from artist) */}
        {show.name && show.artist_name && show.name.toLowerCase() !== show.artist_name.toLowerCase() && (
          <div className="text-xs text-muted-foreground mb-2 truncate">{show.name}</div>
        )}

        {/* Venue */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground mb-1.5">
          <MapPin size={12} className="flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-foreground font-medium">{show.venue}</div>
            <div>{location}</div>
          </div>
        </div>

        {/* Date + Time */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-1.5">
          <span className="flex items-center gap-1"><Calendar size={12} />{dateStr}</span>
          {timeStr && <span className="flex items-center gap-1"><Clock size={12} />{timeStr}</span>}
        </div>

        {/* Price */}
        {show.price_range && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5">
            <Ticket size={12} />
            <span>{show.price_range.min}–{show.price_range.max} {show.price_range.currency}</span>
          </div>
        )}

        {/* Lineup */}
        {otherArtists.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
            <Users size={12} className="flex-shrink-0" />
            <span className="truncate">with {otherArtists.join(", ")}</span>
          </div>
        )}

        {/* Action */}
        <a
          href={show.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-xs font-medium mt-1"
        >
          <ExternalLink size={12} /> View on Ticketmaster
        </a>
      </div>
    </div>
  );
}
