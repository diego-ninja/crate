import { useEffect } from "react";
import { Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { UpcomingItem } from "./upcoming-model";

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function MapSizeFixer() {
  const map = useMap();

  useEffect(() => {
    const timers = [
      window.setTimeout(() => map.invalidateSize(), 0),
      window.setTimeout(() => map.invalidateSize(), 120),
      window.setTimeout(() => map.invalidateSize(), 320),
    ];

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [map]);

  return null;
}

export function UpcomingShowMap({
  item,
  position,
  dateLabel,
  timeLabel,
  locationLabel,
}: {
  item: UpcomingItem;
  position: [number, number];
  dateLabel: string;
  timeLabel: string;
  locationLabel: string;
}) {
  return (
    <>
      <MapSizeFixer />
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
      <Marker position={position}>
        <Popup className="upcoming-marker-popup">
          <div className="space-y-2 text-xs">
            <div>
              <div className="font-semibold text-foreground">{item.venue || item.artist}</div>
              <div className="text-muted-foreground">{locationLabel || item.subtitle}</div>
            </div>
            <div className="space-y-1 text-muted-foreground">
              <div>{dateLabel}</div>
              {timeLabel ? <div>Doors / time: {timeLabel}</div> : null}
              {item.lineup?.length ? <div>Lineup: {item.lineup.slice(0, 6).join(" · ")}</div> : null}
            </div>
          </div>
        </Popup>
      </Marker>
    </>
  );
}
