import { useState, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShowCard, type ShowEvent } from "@/components/shows/ShowCard";
import {
  ChevronLeft, ChevronRight, Loader2, MapPin, Calendar as CalendarIcon, List,
} from "lucide-react";

// Fix Leaflet default marker icon
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

type ViewMode = "calendar" | "map" | "list";

export function Shows() {
  const [events, setEvents] = useState<ShowEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [country, setCountry] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedShow, setSelectedShow] = useState<ShowEvent | null>(null);

  useEffect(() => {
    setLoading(true);
    api<{ events: ShowEvent[] }>(`/api/shows?country=${country}&limit=5`)
      .then((d) => setEvents(d.events || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [country]);

  // Group events by date
  const eventsByDate = useMemo(() => {
    const map: Record<string, ShowEvent[]> = {};
    for (const e of events) {
      const date = e.local_date || (e.date ? e.date.split("T")[0] : "");
      if (date) {
        (map[date] ??= []).push(e);
      }
    }
    return map;
  }, [events]);

  // Events with coordinates for map
  const mappableEvents = useMemo(
    () => events.filter((e) => e.latitude && e.longitude),
    [events],
  );

  // Calendar month events
  const monthEvents = useMemo(() => {
    const { year, month } = currentMonth;
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    return events.filter((e) => (e.local_date || "").startsWith(prefix));
  }, [events, currentMonth]);

  function prevMonth() {
    setCurrentMonth((p) => {
      const m = p.month - 1;
      return m < 0 ? { year: p.year - 1, month: 11 } : { year: p.year, month: m };
    });
  }

  function nextMonth() {
    setCurrentMonth((p) => {
      const m = p.month + 1;
      return m > 11 ? { year: p.year + 1, month: 0 } : { year: p.year, month: m };
    });
  }

  const monthName = new Date(currentMonth.year, currentMonth.month).toLocaleDateString(undefined, {
    month: "long", year: "numeric",
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Upcoming Shows</h1>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Country (ES, US, GB...)"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
            className="w-28 text-xs"
          />
          <div className="flex border border-border rounded-lg overflow-hidden">
            {(["calendar", "map", "list"] as ViewMode[]).map((m) => (
              <button
                key={m}
                className={`px-3 py-1.5 text-xs ${viewMode === m ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setViewMode(m)}
              >
                {m === "calendar" ? <CalendarIcon size={14} /> : m === "map" ? <MapPin size={14} /> : <List size={14} />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          {country ? `No upcoming shows found in ${country}` : "No upcoming shows found. Configure TICKETMASTER_API_KEY in settings."}
        </div>
      ) : (
        <>
          {/* Calendar view */}
          {viewMode === "calendar" && (
            <div>
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
                {monthEvents.length} shows this month from your library artists
              </div>
            </div>
          )}

          {/* Map view */}
          {viewMode === "map" && (
            <div className="rounded-xl overflow-hidden border border-border" style={{ height: 500 }}>
              <MapContainer
                center={[40.4168, -3.7038]}
                zoom={4}
                style={{ height: "100%", width: "100%" }}
                scrollWheelZoom
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />
                <MapAutoFit events={mappableEvents} />
                {mappableEvents.map((e, i) => (
                  <Marker
                    key={e.id || i}
                    position={[parseFloat(e.latitude!), parseFloat(e.longitude!)]}
                  >
                    <Popup>
                      <ShowCard show={e} />
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          )}

          {/* List view */}
          {viewMode === "list" && (
            <div className="space-y-2">
              {events.map((e, i) => (
                <ShowListItem key={e.id || i} show={e} onClick={() => setSelectedShow(e)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Show detail popup */}
      {selectedShow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setSelectedShow(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <ShowCard show={selectedShow} />
          </div>
        </div>
      )}
    </div>
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
  // Monday-first: shift Sunday(0) to end
  const offset = (firstDay + 6) % 7;
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
      {dayNames.map((d) => (
        <div key={d} className="bg-card px-2 py-1.5 text-[10px] text-center text-muted-foreground uppercase">
          {d}
        </div>
      ))}
      {cells.map((day, i) => {
        const dateStr = day
          ? `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
          : "";
        const dayEvents = dateStr ? eventsByDate[dateStr] || [] : [];
        const isToday = dateStr === todayStr;

        return (
          <div
            key={i}
            className={`bg-card min-h-[80px] p-1.5 ${!day ? "opacity-30" : ""} ${isToday ? "ring-1 ring-primary/40" : ""}`}
          >
            {day && (
              <>
                <div className={`text-xs mb-1 ${isToday ? "text-primary font-bold" : "text-muted-foreground"}`}>
                  {day}
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((e, j) => (
                    <button
                      key={j}
                      className="w-full text-left"
                      onClick={() => onSelectShow(e)}
                    >
                      <ShowCard show={e} compact />
                    </button>
                  ))}
                  {dayEvents.length > 3 && (
                    <div className="text-[10px] text-muted-foreground px-1">+{dayEvents.length - 3} more</div>
                  )}
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
  const dateStr = d
    ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : show.local_date;
  const location = [show.city, show.country].filter(Boolean).join(", ");

  return (
    <button
      className="flex items-center gap-4 p-3 bg-card border border-border rounded-lg hover:bg-white/5 transition-colors w-full text-left"
      onClick={onClick}
    >
      {show.artist_name && (
        <img
          src={`/api/artist/${encPath(show.artist_name)}/photo`}
          alt=""
          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
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
        {show.price_range && (
          <div>{show.price_range.min}–{show.price_range.max} {show.price_range.currency}</div>
        )}
      </div>
    </button>
  );
}


// ── Map auto-fit ──

function MapAutoFit({ events }: { events: ShowEvent[] }) {
  const map = useMap();

  useEffect(() => {
    if (events.length === 0) return;
    const bounds = L.latLngBounds(
      events.map((e) => [parseFloat(e.latitude!), parseFloat(e.longitude!)] as L.LatLngTuple),
    );
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
  }, [events, map]);

  return null;
}
