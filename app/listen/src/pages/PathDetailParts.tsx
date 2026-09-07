import type { RefObject } from "react";
import { MapPin } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import { albumCoverApiUrl } from "@/lib/library-routes";
import type { PathDetail } from "./paths-model";

export function PathRouteVisualization({
  path,
  activeStep,
  animate,
  onPlayFromStep,
}: {
  path: PathDetail;
  activeStep: number;
  animate: boolean;
  onPlayFromStep: (startIndex: number) => void;
}) {
  const nodeCount = path.tracks.length;
  const travelerPos = activeStep >= 0 ? activeStep : 0;
  const activeTrack = activeStep >= 0 ? path.tracks[activeStep] : undefined;

  return (
    <div className="mb-6 rounded-xl border border-text-primary/8 bg-surface-canvas/20 p-4">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em]">
        <span className="flex items-center gap-1 text-accent-action/60">
          <MapPin size={9} /> {path.origin.label}
        </span>
        <span className="flex items-center gap-1 text-accent-action/60">
          {path.destination.label} <MapPin size={9} />
        </span>
      </div>

      <div className="relative py-5">
        <div className="relative mx-3">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-text-primary/8" />
          <div
            className={`path-progress-fill absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full ${
              animate ? "transition-[width] duration-[1200ms] ease-out" : ""
            }`}
            style={{
              width: `${(travelerPos / Math.max(1, nodeCount - 1)) * 100}%`,
            }}
          />
          <div className="relative flex items-center justify-between">
            {path.tracks.map((track, index) => {
              const isPast = index <= travelerPos;
              const isActive = index === activeStep;
              return (
                <button
                  key={track.step}
                  onClick={() => onPlayFromStep(index)}
                  title={`${track.title} — ${track.artist}`}
                  className="group relative flex size-4 shrink-0 items-center justify-center"
                >
                  <div
                    className={`rounded-full transition-all duration-300 ${
                      isActive
                        ? "path-node-active h-3 w-3 bg-accent-action"
                        : isPast
                          ? "h-1.5 w-1.5 bg-accent-action/60"
                          : "h-1.5 w-1.5 bg-text-primary/20 group-hover:bg-text-primary/40"
                    }`}
                  />
                </button>
              );
            })}
          </div>
          <div
            className={`pointer-events-none absolute top-1/2 ${
              animate ? "transition-[left] duration-[1200ms] ease-out" : ""
            }`}
            style={{
              left: `${(travelerPos / Math.max(1, nodeCount - 1)) * 100}%`,
            }}
          >
            <div className="absolute -inset-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-action/20 blur-md" />
            <div className="path-traveler-node size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-action" />
          </div>
        </div>
      </div>

      {activeTrack ? (
        <div className="border-y border-accent-action/20 bg-accent-action/5 p-3">
          <div className="flex items-center gap-3">
            {activeTrack.album_id ? (
              <CrateImage
                src={albumCoverApiUrl(
                  {
                    albumId: activeTrack.album_id,
                    albumEntityUid: activeTrack.album_entity_uid,
                    artistEntityUid: activeTrack.artist_entity_uid,
                  },
                  { size: 80 },
                )}
                alt=""
                className=" size-10 shrink-0 rounded-lg bg-text-primary/5 object-cover shadow-md"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-text-primary">
                {activeTrack.title}
              </div>
              <div className="truncate text-xs text-text-primary/50">
                {activeTrack.artist}
                {activeTrack.album ? <> · {activeTrack.album}</> : null}
              </div>
            </div>
            <span className="font-mono text-xs tabular-nums text-accent-action/70">
              {activeStep + 1}/{nodeCount}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PathTrackList({
  path,
  activeStep,
  activeTrackRef,
  onPlayFromStep,
}: {
  path: PathDetail;
  activeStep: number;
  activeTrackRef: RefObject<HTMLDivElement | null>;
  onPlayFromStep: (startIndex: number) => void;
}) {
  return (
    <div className="space-y-1">
      {path.tracks.map((track, index) => {
        const isActive = index === activeStep;
        return (
          <div
            key={track.step}
            ref={isActive ? activeTrackRef : null}
            role="button"
            tabIndex={0}
            onClick={() => onPlayFromStep(index)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPlayFromStep(index);
              }
            }}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
              isActive
                ? "border-accent-action/30 bg-accent-action/10"
                : "border-transparent hover:bg-text-primary/[0.03]"
            }`}
          >
            <div className="flex size-7 shrink-0 items-center justify-center">
              {isActive ? (
                <div className="path-node-active size-2.5 rounded-full bg-accent-action" />
              ) : (
                <span className="font-mono text-xs tabular-nums text-text-primary/20">
                  {index + 1}
                </span>
              )}
            </div>

            {track.album_id ? (
              <CrateImage
                src={albumCoverApiUrl(
                  {
                    albumId: track.album_id,
                    albumEntityUid: track.album_entity_uid,
                    artistEntityUid: track.artist_entity_uid,
                  },
                  { size: 80 },
                )}
                alt=""
                className=" size-10 shrink-0 rounded-md bg-text-primary/5 object-cover"
              />
            ) : (
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-text-primary/5">
                <MapPin size={14} className="text-text-primary/15" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div
                className={`truncate text-sm ${
                  isActive
                    ? "font-semibold text-accent-action"
                    : "text-text-primary"
                }`}
              >
                {track.title}
              </div>
              <div className="truncate text-xs text-text-primary/40">
                {track.artist}
                {track.album ? <> · {track.album}</> : null}
              </div>
            </div>

            <span className="shrink-0 rounded-full border border-text-primary/6 bg-text-primary/[0.02] px-2 py-0.5 font-mono text-xs tabular-nums text-text-primary/25">
              {track.distance.toFixed(3)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
