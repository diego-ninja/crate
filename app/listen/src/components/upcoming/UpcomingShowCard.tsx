import { useMemo } from "react";
import { MapContainer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { cn } from "@/lib/utils";

import {
  UpcomingShowCollapsedView,
  UpcomingShowExpandedView,
} from "./UpcomingShowCardViews";
import { UpcomingShowMap } from "./UpcomingShowMap";
import type { UpcomingItem } from "./upcoming-model";
import { useUpcomingShowActions } from "./use-upcoming-show-actions";

export function UpcomingShowCard({
  item,
  expanded,
  onToggle,
  onAttendanceChange,
}: {
  item: UpcomingItem;
  expanded: boolean;
  onToggle: () => void;
  onAttendanceChange?: (attending: boolean) => void;
}) {
  const {
    attending,
    savingAttendance,
    playingSetlist,
    toggleAttendance,
    playProbableSetlist,
  } = useUpcomingShowActions(item, onAttendanceChange);

  const position = useMemo<[number, number] | null>(() => {
    if (item.latitude == null || item.longitude == null) return null;
    return [item.latitude, item.longitude];
  }, [item.latitude, item.longitude]);

  const dateLabel = item.date
    ? new Date(`${item.date}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const timeLabel = item.time ? item.time.slice(0, 5) : "";
  const locationLabel = [item.city, item.country].filter(Boolean).join(", ");

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border transition-[height,transform,border-color,background-color,box-shadow] duration-300 ease-out",
        expanded
          ? "animate-upcoming-expand border-primary/20 shadow-[0_18px_60px_rgba(6,182,212,0.14)]"
          : "border-primary/10 bg-white/[0.02] hover:border-primary/25 hover:bg-white/[0.04]",
      )}
      style={{ height: expanded ? 320 : 92 }}
      onClick={!expanded ? onToggle : undefined}
    >
      <div className="absolute inset-0 bg-raised-surface" />

      <div
        className={cn(
          "upcoming-map absolute inset-0 z-0 transition-opacity duration-300",
          expanded ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {expanded && position ? (
          <MapContainer
            center={position}
            zoom={14}
            style={{ width: "100%", height: "100%" }}
            zoomControl={false}
            attributionControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            touchZoom={false}
            boxZoom={false}
            keyboard={false}
          >
            <UpcomingShowMap
              item={item}
              position={position}
              dateLabel={dateLabel}
              timeLabel={timeLabel}
              locationLabel={locationLabel}
            />
          </MapContainer>
        ) : null}
      </div>

      {!expanded ? (
        <UpcomingShowCollapsedView
          item={item}
          attending={attending}
          savingAttendance={savingAttendance}
          playingSetlist={playingSetlist}
          dateLabel={dateLabel}
          timeLabel={timeLabel}
          onToggleAttendance={toggleAttendance}
          onPlaySetlist={playProbableSetlist}
        />
      ) : (
        <UpcomingShowExpandedView
          item={item}
          attending={attending}
          savingAttendance={savingAttendance}
          playingSetlist={playingSetlist}
          dateLabel={dateLabel}
          timeLabel={timeLabel}
          locationLabel={locationLabel}
          onToggleAttendance={toggleAttendance}
          onPlaySetlist={playProbableSetlist}
          onClose={onToggle}
        />
      )}
    </div>
  );
}
