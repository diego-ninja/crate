import { useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

import { TrackRow } from "@/components/cards/TrackRow";
import { useContentDensity } from "@/lib/content-density";
import { CONTENT_DENSITY_METRICS } from "@crate/ui/lib/content-density";
import { toTrackRowData } from "@/lib/track-row-data";
import type {
  CuratedPlaylistTrack,
  CuratedTrackListProps,
} from "@/pages/curated-playlist-types";

const VIRTUAL_TRACK_THRESHOLD = 80;
function CuratedTrackRow({
  track,
  index,
  playlistOptions,
  onAddToPlaylist,
  onCreatePlaylist,
  onActionMenuOpen,
  onPlayTrack,
}: CuratedTrackListProps & { track: CuratedPlaylistTrack; index: number }) {
  return (
    <TrackRow
      track={toTrackRowData({
        ...track,
        id: track.track_id ?? track.track_path ?? track.title,
        library_track_id: track.track_id,
      })}
      index={index}
      showCoverThumb
      showArtist
      showAlbum
      playlistOptions={playlistOptions}
      onAddToPlaylist={onAddToPlaylist}
      onCreatePlaylist={onCreatePlaylist}
      onActionMenuOpen={onActionMenuOpen}
      onPlayOverride={() => onPlayTrack(track.id)}
    />
  );
}

function VirtualizedCuratedTrackList(props: CuratedTrackListProps) {
  const density = useContentDensity();
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const rowVirtualizer = useWindowVirtualizer({
    count: props.tracks.length,
    estimateSize: () => CONTENT_DENSITY_METRICS[density].rowEstimate,
    getItemKey: (index) => props.tracks[index]?.id ?? index,
    overscan: 12,
    scrollMargin,
  });

  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [density, rowVirtualizer]);

  useLayoutEffect(() => {
    const node = listRef.current;
    if (!node) return;

    const measure = () => {
      setScrollMargin(node.getBoundingClientRect().top + window.scrollY);
    };
    measure();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    resizeObserver?.observe(node);
    window.addEventListener("resize", measure, { passive: true });

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [props.tracks.length]);

  return (
    <div
      ref={listRef}
      className="relative"
      style={{
        height: `${rowVirtualizer.getTotalSize()}px`,
        contain: "layout paint style",
      }}
    >
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const track = props.tracks[virtualRow.index];
        if (!track) return null;
        return (
          <div
            key={virtualRow.key}
            ref={rowVirtualizer.measureElement}
            data-index={virtualRow.index}
            className="absolute left-0 top-0 w-full pb-1"
            style={{
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }}
          >
            <CuratedTrackRow
              {...props}
              track={track}
              index={virtualRow.index + 1}
            />
          </div>
        );
      })}
    </div>
  );
}

export function CuratedPlaylistTrackList(props: CuratedTrackListProps) {
  if (props.tracks.length < VIRTUAL_TRACK_THRESHOLD) {
    return (
      <div className="space-y-[var(--content-list-gap)]">
        {props.tracks.map((track, index) => (
          <CuratedTrackRow
            key={track.id}
            {...props}
            track={track}
            index={index + 1}
          />
        ))}
      </div>
    );
  }

  return <VirtualizedCuratedTrackList {...props} />;
}
