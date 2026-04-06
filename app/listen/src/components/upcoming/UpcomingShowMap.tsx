import { useEffect, useRef } from "react";
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

function MapViewportFixer({ position }: { position: [number, number] }) {
  const map = useMap();

  useEffect(() => {
    const syncViewport = () => {
      map.invalidateSize({ pan: false });
      // Offset the center so the marker sits in the upper third, leaving room for the popup above
      const containerHeight = map.getContainer().getBoundingClientRect().height;
      const px = map.project(position, map.getZoom());
      px.y -= containerHeight * 0.15;
      const offsetCenter = map.unproject(px, map.getZoom());
      map.setView(offsetCenter, map.getZoom(), { animate: false });
    };
    const timers = [0, 120, 320].map((delay) => window.setTimeout(syncViewport, delay));
    const observer = new ResizeObserver(syncViewport);
    observer.observe(map.getContainer());

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [map, position]);

  return null;
}

export function UpcomingShowMap({
  item,
  position,
  dateLabel,
  timeLabel,
  addressLabel,
  locationLabel,
}: {
  item: UpcomingItem;
  position: [number, number];
  dateLabel: string;
  timeLabel: string;
  addressLabel: string;
  locationLabel: string;
}) {
  const markerRef = useRef<L.Marker>(null);

  useEffect(() => {
    const timers = [0, 120, 320].map((delay) =>
      window.setTimeout(() => {
        markerRef.current?.openPopup();
      }, delay),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [position]);

  return (
    <>
      <MapViewportFixer position={position} />
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
      <Marker ref={markerRef} position={position}>
        <Popup
          className="upcoming-marker-popup"
          autoClose={false}
          closeOnClick={false}
          closeOnEscapeKey={false}
          autoPan={false}
        >
          <div className="space-y-2 text-xs">
            <div>
              <div className="font-semibold text-foreground">{item.venue || item.artist}</div>
              {addressLabel ? <div className="text-white/75">{addressLabel}</div> : null}
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
