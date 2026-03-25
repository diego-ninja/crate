import { useState, useEffect, useMemo, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { ShowCard, type ShowEvent } from "@/components/shows/ShowCard";
import { Loader2, MapPin, Calendar as CalendarIcon, List, ChevronLeft, ChevronRight } from "lucide-react";

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

  // Stream shows via fetch + ReadableStream
  useEffect(() => {
    setLoading(true);
    setDone(false);
    setEvents([]);
    let cancelled = false;

    async function streamShows() {
      try {
        const res = await fetch("/api/shows?limit=5", { credentials: "include" });
        if (!res.ok || !res.body) { setLoading(false); setDone(true); return; }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done: readerDone, value } = await reader.read();
          if (readerDone || cancelled) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("event: done")) {
              if (!cancelled) { setLoading(false); setDone(true); }
              return;
            }
            if (line.startsWith("data: ")) {
              try {
                const show: ShowEvent = JSON.parse(line.slice(6));
                if (!cancelled) setEvents((prev) => [...prev, show]);
              } catch { /* skip */ }
            }
          }
        }
      } catch { /* network error */ }
      if (!cancelled) { setLoading(false); setDone(true); }
    }

    streamShows();
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

  const mappableEvents = useMemo(
    () => events.filter((e) => e.latitude && e.longitude),
    [events],
  );

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
            Scanning... {events.length} shows
          </span>
        )}
        {done && events.length > 0 && (
          <span className={`text-xs px-2 py-1 rounded ${isMap ? "bg-card/90 backdrop-blur" : ""} text-muted-foreground`}>
            {events.length} shows
          </span>
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
            {events.map((e, i) => (
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

function LiveMarkers({ events }: { events: ShowEvent[] }) {
  return (
    <>
      {events.map((e, i) => (
        <Marker key={e.id || i} position={[parseFloat(e.latitude!), parseFloat(e.longitude!)]}>
          <Popup maxWidth={360} minWidth={340}>
            <ShowCard show={e} />
          </Popup>
        </Marker>
      ))}
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
