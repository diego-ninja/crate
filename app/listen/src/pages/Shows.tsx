import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { Loader2, ExternalLink, Calendar } from "lucide-react";
import { useApi } from "@/hooks/use-api";

interface ShowEvent {
  id: string;
  artist_name: string;
  date: string;
  local_time?: string;
  venue: string;
  city: string;
  country: string;
  country_code: string;
  url?: string;
  image_url?: string;
  lineup?: string[];
  artist_genres?: string[];
  artist_listeners?: number;
}

interface ShowsResponse {
  shows: ShowEvent[];
  filters: {
    cities: string[];
    countries: string[];
  };
}

export function Shows() {
  const navigate = useNavigate();
  const [city, setCity] = useState<string>("all");
  const { data, loading } = useApi<ShowsResponse>("/api/shows");

  const shows = useMemo(() => {
    if (!data?.shows) return [];
    if (city === "all") return data.shows;
    return data.shows.filter((s) => s.city === city);
  }, [data, city]);

  const grouped = useMemo(() => {
    const map = new Map<string, ShowEvent[]>();
    for (const s of shows) {
      const month = new Date(s.date).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
      });
      if (!map.has(month)) map.set(month, []);
      map.get(month)!.push(s);
    }
    return map;
  }, [shows]);

  const cities = data?.filters?.cities ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Shows</h1>

      {/* City filter pills */}
      {cities.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCity("all")}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              city === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
            }`}
          >
            All
          </button>
          {cities.map((c) => (
            <button
              key={c}
              onClick={() => setCity(c)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                city === c
                  ? "bg-primary text-primary-foreground"
                  : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="text-primary animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && shows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Calendar size={32} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No upcoming shows found
          </p>
        </div>
      )}

      {/* Grouped by month */}
      {!loading &&
        Array.from(grouped.entries()).map(([month, events]) => (
          <div key={month} className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {month}
            </h2>
            <div className="space-y-1">
              {events.map((show) => {
                const d = new Date(show.date);
                const day = d.getDate();
                const monthShort = d.toLocaleDateString("en-US", {
                  month: "short",
                });

                return (
                  <div
                    key={show.id}
                    onClick={() =>
                      navigate(`/artist/${encodeURIComponent(show.artist_name)}`)
                    }
                    className="flex items-center gap-4 rounded-lg px-3 py-3 hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    {/* Date block */}
                    <div className="w-12 flex-shrink-0 text-center">
                      <div className="text-xl font-bold text-foreground leading-tight">
                        {day}
                      </div>
                      <div className="text-[11px] text-muted-foreground uppercase">
                        {monthShort}
                      </div>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">
                        {show.artist_name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {show.venue} · {show.city}
                        {show.country_code ? `, ${show.country_code}` : ""}
                      </div>
                      {/* Genre pills */}
                      {show.artist_genres && show.artist_genres.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {show.artist_genres.slice(0, 2).map((g) => (
                            <span
                              key={g}
                              className="inline-flex items-center rounded-md border border-white/10 text-[10px] px-1.5 py-0 text-muted-foreground"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Tickets link */}
                    {show.url && (
                      <a
                        href={show.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-white/20 transition-colors flex-shrink-0"
                      >
                        Tickets
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}
