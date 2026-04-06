import { useState, useEffect, useMemo, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { ShowCard, type ShowEvent, getGenreColor } from "@/components/shows/ShowCard";
import { Loader2, MapPin, Calendar as CalendarIcon, List, ChevronLeft, ChevronRight, Filter } from "lucide-react";

// Fix Leaflet default marker icon
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

type ViewMode = "map" | "calendar" | "list";

export function Shows() {
  const [events, setEvents] = useState<ShowEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [selectedShow, setSelectedShow] = useState<ShowEvent | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [genreFilter, setGenreFilter] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // Geolocate user on mount
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
        () => setUserLocation([48.8566, 2.3522]), // Paris fallback
        { timeout: 5000 },
      );
    } else {
      setUserLocation([48.8566, 2.3522]);
    }
  }, []);

  // Fetch shows from DB
  useEffect(() => {
    setLoading(true);
    setDone(false);
    setEvents([]);
    let cancelled = false;

    async function fetchShows() {
      try {
        const res = await fetch("/api/shows/cached?limit=200", { credentials: "include" });
        if (!res.ok) { setLoading(false); setDone(true); return; }
        const data = await res.json();
        if (cancelled) return;
        const mapped: ShowEvent[] = (data.events || []).map((e: Record<string, unknown>) => ({
          id: e.external_id || e.id || "",
          name: e.artist_name || "",
          date: e.date || "",
          local_date: (e.date as string || "").slice(0, 10),
          local_time: e.local_time || "",
          venue: e.venue || "",
          address_line1: (e.address_line1 as string) || undefined,
          city: e.city || "",
          region: e.region || "",
          country: e.country || "",
          country_code: e.country_code || "",
          url: e.url || "",
          image: e.image_url || "",
          lineup: Array.isArray(e.lineup) ? e.lineup : (e.artist_name ? [e.artist_name as string] : []),
          price_range: null,
          status: e.status || "onsale",
          latitude: e.latitude ? String(e.latitude) : undefined,
          longitude: e.longitude ? String(e.longitude) : undefined,
          artist_name: e.artist_name as string || "",
          artist_id: typeof e.artist_id === "number" ? e.artist_id : undefined,
          artist_slug: typeof e.artist_slug === "string" ? e.artist_slug : undefined,
          lineup_artists: Array.isArray(e.lineup_artists) ? e.lineup_artists as ShowEvent["lineup_artists"] : undefined,
          artist_listeners: 0,
          artist_genres: Array.isArray(e.artist_genres) ? e.artist_genres : [],
        }));
        setEvents(mapped);
      } catch { /* network error */ }
      if (!cancelled) { setLoading(false); setDone(true); }
    }

    fetchShows();
    return () => { cancelled = true; };
  }, []);

  const eventsByDate = useMemo(() => {
    const map: Record<string, ShowEvent[]> = {};
    for (const e of events) {
      const date = e.local_date || (e.date ? e.date.split("T")[0] : "");
      if (date) (map[date] ??= []).push(e);
    }
    return map;
  }, [events]);

  // Apply genre filter
  const filteredEvents = useMemo(() => {
    if (!genreFilter) return events;
    return events.filter((e) =>
      e.artist_genres?.some((g) => g.toLowerCase().includes(genreFilter.toLowerCase()))
    );
  }, [events, genreFilter]);

  const mappableEvents = useMemo(
    () => filteredEvents.filter((e) => e.latitude && e.longitude),
    [filteredEvents],
  );

  // Available genres from events
  const availableGenres = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of events) {
      for (const g of e.artist_genres || []) {
        counts[g] = (counts[g] || 0) + 1;
      }
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 20);
  }, [events]);

  const monthEvents = useMemo(() => {
    const { year, month } = currentMonth;
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    return events.filter((e) => (e.local_date || "").startsWith(prefix));
  }, [events, currentMonth]);

  const prevMonth = useCallback(() => {
    setCurrentMonth((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { year: p.year, month: p.month - 1 });
  }, []);
  const nextMonth = useCallback(() => {
    setCurrentMonth((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { year: p.year, month: p.month + 1 });
  }, []);

  const monthName = new Date(currentMonth.year, currentMonth.month).toLocaleDateString(undefined, {
    month: "long", year: "numeric",
  });

  const isMap = viewMode === "map";

  const controls = (
    <div className={`flex items-center gap-2 ${isMap ? "absolute top-4 right-4 z-[1000]" : "mb-6 justify-between"}`}>
      {!isMap && <h1 className="text-2xl font-bold">Upcoming Shows</h1>}
      <div className="flex items-center gap-2">
        {loading && (
          <span className={`text-xs flex items-center gap-1.5 px-2 py-1 rounded ${isMap ? "bg-card/90 backdrop-blur" : ""} text-muted-foreground`}>
            <Loader2 size={12} className="animate-spin" />
            {filteredEvents.length} shows
          </span>
        )}
        {done && filteredEvents.length > 0 && (
          <span className={`text-xs px-2 py-1 rounded ${isMap ? "bg-card/90 backdrop-blur" : ""} text-muted-foreground`}>
            {filteredEvents.length} shows
          </span>
        )}
        {isMap && (
          <button
            className={`p-1.5 rounded ${isMap ? "bg-card/90 backdrop-blur" : ""} ${showFilters ? "text-primary" : "text-muted-foreground"} hover:text-foreground`}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter size={14} />
          </button>
        )}
        <div className={`flex border rounded-lg overflow-hidden ${isMap ? "border-border/50 bg-card/90 backdrop-blur" : "border-border"}`}>
          {(["map", "calendar", "list"] as ViewMode[]).map((m) => (
            <button
              key={m}
              className={`px-2.5 py-1.5 text-xs transition-colors ${viewMode === m ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setViewMode(m)}
            >
              {m === "calendar" ? <CalendarIcon size={14} /> : m === "map" ? <MapPin size={14} /> : <List size={14} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  if (!isMap && events.length === 0 && done) {
    return (
      <div>
        {controls}
        <div className="text-center py-24 text-muted-foreground">No upcoming shows found for your library artists</div>
      </div>
    );
  }

  return (
    <>
      {/* Map view — full viewport */}
      {isMap && (
        <div className="fixed inset-0 md:left-[220px] z-10">
          <div className="relative w-full h-full">
            {controls}
            {/* Genre filter panel */}
            {showFilters && availableGenres.length > 0 && (
              <div className="absolute top-14 right-4 z-[1000] bg-card/95 backdrop-blur rounded-lg border border-border p-3 w-[200px] max-h-[300px] overflow-y-auto">
                <div className="text-xs font-medium mb-2">Filter by genre</div>
                <button
                  className={`block w-full text-left text-xs px-2 py-1 rounded mb-1 ${!genreFilter ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setGenreFilter("")}
                >All genres</button>
                {availableGenres.map(([genre, count]) => (
                  <button
                    key={genre}
                    className={`flex items-center gap-2 w-full text-left text-xs px-2 py-1 rounded ${genreFilter === genre ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setGenreFilter(genreFilter === genre ? "" : genre)}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getGenreColor([genre]) }} />
                    <span className="flex-1 truncate">{genre}</span>
                    <span className="text-[10px]">{count}</span>
                  </button>
                ))}
              </div>
            )}
            {userLocation && (
              <MapContainer
                center={userLocation}
                zoom={6}
                style={{ height: "100%", width: "100%" }}
                scrollWheelZoom
                zoomControl={false}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />
                <InvalidateSize />
                <LiveMarkers events={mappableEvents} />
              </MapContainer>
            )}
            {!userLocation && (
              <div className="flex items-center justify-center h-full bg-background">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Calendar view */}
      {viewMode === "calendar" && (
        <div>
          {controls}
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" size="sm" onClick={prevMonth}><ChevronLeft size={16} /></Button>
            <span className="font-semibold capitalize">{monthName}</span>
            <Button variant="ghost" size="sm" onClick={nextMonth}><ChevronRight size={16} /></Button>
          </div>
          <CalendarGrid
            year={currentMonth.year}
            month={currentMonth.month}
            eventsByDate={eventsByDate}
            onSelectShow={setSelectedShow}
          />
          <div className="text-xs text-muted-foreground mt-3">
            {monthEvents.length} shows this month
          </div>
        </div>
      )}

      {/* List view */}
      {viewMode === "list" && (
        <div>
          {controls}
          <div className="space-y-2">
            {filteredEvents.map((e, i) => (
              <ShowListItem key={e.id || i} show={e} onClick={() => setSelectedShow(e)} />
            ))}
          </div>
        </div>
      )}

      {/* Detail overlay */}
      {selectedShow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setSelectedShow(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <ShowCard show={selectedShow} />
          </div>
        </div>
      )}
    </>
  );
}


// ── Live markers (re-renders as events stream in) ──

function InvalidateSize() {
  const map = useMap();
  useEffect(() => {
    // Repeatedly invalidate until tiles render properly
    const timers = [200, 500, 1000, 2000].map((ms) =>
      setTimeout(() => map.invalidateSize(), ms)
    );
    // Also observe container resize
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => { timers.forEach(clearTimeout); observer.disconnect(); };
  }, [map]);
  return null;
}

function coloredIcon(color: string) {
  return L.divIcon({
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.8);box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
  });
}

function PopupCenterer() {
  const map = useMap();
  useEffect(() => {
    function onPopupOpen(e: L.PopupEvent) {
      const popup = e.popup;
      const latlng = popup.getLatLng();
      if (!latlng) return;
      const px = map.project(latlng);
      const container = popup.getElement();
      if (container) {
        const popupHeight = container.getBoundingClientRect().height;
        px.y -= popupHeight / 2;
      }
      map.panTo(map.unproject(px), { animate: true, duration: 0.3 });
    }
    map.on("popupopen", onPopupOpen);
    return () => { map.off("popupopen", onPopupOpen); };
  }, [map]);
  return null;
}

function LiveMarkers({ events }: { events: ShowEvent[] }) {
  return (
    <>
      <PopupCenterer />
      {events.map((e, i) => {
        const color = getGenreColor(e.artist_genres);
        return (
          <Marker
            key={e.id || i}
            position={[parseFloat(e.latitude!), parseFloat(e.longitude!)]}
            icon={coloredIcon(color)}
          >
            <Popup maxWidth={360} minWidth={340} autoPan={false}>
              <ShowCard show={e} />
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}


// ── Calendar Grid ──

function CalendarGrid({
  year, month, eventsByDate, onSelectShow,
}: {
  year: number;
  month: number;
  eventsByDate: Record<string, ShowEvent[]>;
  onSelectShow: (e: ShowEvent) => void;
}) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const cells: (number | null)[] = [];
  const offset = (firstDay + 6) % 7;
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
        <div key={d} className="bg-card px-2 py-1.5 text-[10px] text-center text-muted-foreground uppercase">{d}</div>
      ))}
      {cells.map((day, i) => {
        const dateStr = day ? `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
        const dayEvents = dateStr ? eventsByDate[dateStr] || [] : [];
        const isToday = dateStr === todayStr;
        return (
          <div key={i} className={`bg-card min-h-[80px] p-1.5 ${!day ? "opacity-30" : ""} ${isToday ? "ring-1 ring-primary/40" : ""}`}>
            {day && (
              <>
                <div className={`text-xs mb-1 ${isToday ? "text-primary font-bold" : "text-muted-foreground"}`}>{day}</div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((e, j) => (
                    <button key={j} className="w-full text-left" onClick={() => onSelectShow(e)}>
                      <ShowCard show={e} compact />
                    </button>
                  ))}
                  {dayEvents.length > 3 && <div className="text-[10px] text-muted-foreground px-1">+{dayEvents.length - 3} more</div>}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ── List item ──

function ShowListItem({ show, onClick }: { show: ShowEvent; onClick: () => void }) {
  const d = show.date ? new Date(show.date) : null;
  const dateStr = d ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : show.local_date;
  const location = [show.city, show.country].filter(Boolean).join(", ");

  return (
    <button className="flex items-center gap-4 p-3 bg-card border border-border rounded-lg hover:bg-white/5 transition-colors w-full text-left" onClick={onClick}>
      {d && (
        <div className="w-10 text-center flex-shrink-0">
          <div className="text-lg font-bold text-primary leading-none">{d.getDate()}</div>
          <div className="text-[10px] uppercase text-muted-foreground">{d.toLocaleDateString(undefined, { month: "short" })}</div>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{show.artist_name || show.name}</div>
        <div className="text-xs text-muted-foreground truncate">{show.venue} — {location}</div>
      </div>
      <div className="text-xs text-muted-foreground text-right flex-shrink-0">
        <div>{dateStr}</div>
        {show.price_range && <div>{show.price_range.min}–{show.price_range.max} {show.price_range.currency}</div>}
      </div>
    </button>
  );
}
