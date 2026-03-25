import { useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { encPath, formatCompact } from "@/lib/utils";
import {
  MapPin, Calendar, Clock, Ticket, ExternalLink,
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
  artist_name?: string;
  artist_listeners?: number;
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
  const location = [show.city, show.country].filter(Boolean).join(", ");

  // Headliner = first in Ticketmaster lineup, support = rest
  const allArtists = show.lineup.length > 0
    ? show.lineup
    : (show.artist_name ? [show.artist_name] : []);
  const headliner = allArtists[0] || show.artist_name || "";
  const support = allArtists.slice(1);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden w-[340px] shadow-xl">
      {/* Header image */}
      <div className="relative h-[100px] bg-secondary">
        {show.image ? (
          <img src={show.image} alt="" className="w-full h-full object-cover" />
        ) : headliner ? (
          <img
            src={`/api/artist/${encPath(headliner)}/background`}
            alt=""
            className="w-full h-full object-cover opacity-60"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />

        {/* Lineup avatars — stacked, bottom-left */}
        <div className="absolute -bottom-4 left-4 flex -space-x-2">
          {allArtists.slice(0, 4).map((name) => (
            <ArtistAvatar key={name} name={name} size={36} linked />
          ))}
        </div>

        {show.status === "onsale" && (
          <Badge className="absolute top-2 right-2 bg-green-500/90 text-white text-[10px] border-0">
            On Sale
          </Badge>
        )}
      </div>

      {/* Content */}
      <div className="p-4 pt-6">
        {/* Headliner */}
        <Link
          to={`/artist/${encPath(headliner)}`}
          className="block font-bold text-lg text-foreground hover:text-primary transition-colors truncate mb-0.5"
        >
          {headliner}
        </Link>

        {/* Support acts */}
        {support.length > 0 && (
          <div className="text-xs text-muted-foreground mb-1 truncate">
            {support.slice(0, 4).map((name, i) => (
              <span key={name}>
                {i > 0 && <span> &middot; </span>}
                <Link to={`/artist/${encPath(name)}`} className="hover:text-foreground transition-colors">{name}</Link>
              </span>
            ))}
            {support.length > 4 && <span> +{support.length - 4} more</span>}
          </div>
        )}

        {show.artist_listeners && show.artist_listeners > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 mb-1.5">
            {formatCompact(show.artist_listeners)} listeners
          </Badge>
        )}

        {/* Event/tour name */}
        {show.name && show.name.toLowerCase() !== headliner.toLowerCase() && (
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

        {/* Ticketmaster link */}
        <a
          href={show.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-xs font-medium mt-2"
        >
          <ExternalLink size={12} /> View on Ticketmaster
        </a>
      </div>
    </div>
  );
}


// ── Artist avatar with fallback ──

function ArtistAvatar({ name, size = 36, linked }: { name: string; size?: number; linked?: boolean }) {
  const [failed, setFailed] = useState(false);
  const letter = name.charAt(0).toUpperCase();

  const img = !failed ? (
    <img
      src={`/api/artist/${encPath(name)}/photo`}
      alt={name}
      className="w-full h-full object-cover"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="text-[10px] font-bold text-foreground/60">{letter}</span>
  );

  const wrapper = (
    <div
      className="rounded-full ring-2 ring-card overflow-hidden bg-secondary flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
      title={name}
    >
      {img}
    </div>
  );

  if (linked) {
    return (
      <Link to={`/artist/${encPath(name)}`} className="hover:ring-primary/50 rounded-full transition-all">
        {wrapper}
      </Link>
    );
  }
  return wrapper;
}

function ArtistAvatarStack({ names, size = 18 }: { names: string[]; size?: number }) {
  return (
    <div className="flex -space-x-1 flex-shrink-0">
      {names.map((n) => (
        <ArtistAvatar key={n} name={n} size={size} />
      ))}
    </div>
  );
}
