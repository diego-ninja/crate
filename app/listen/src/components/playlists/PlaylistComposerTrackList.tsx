import { useTranslation } from "react-i18next";
import { GripVertical, Music2, X } from "@crate/ui/icons";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { PlaylistComposerTrack } from "@/components/playlists/playlist-composer-model";
import { getTrackKey } from "@/components/playlists/playlist-composer-model";
import { formatDuration } from "@/lib/utils";

function SortableTrackItem({
  track,
  onRemove,
}: {
  track: PlaylistComposerTrack;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: getTrackKey(track) });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between gap-2 px-3 py-2.5"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab text-text-primary/20 hover:text-text-primary/50 touch-none"
      >
        <GripVertical size={14} />
      </button>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="size-9  rounded-md bg-text-primary/5 flex items-center justify-center shrink-0">
          <Music2 size={15} className="text-text-muted" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm text-text-primary">
            {track.title}
          </div>
          <div className="truncate text-xs text-text-muted">
            {track.artist}
            {track.album ? ` · ${track.album}` : ""}
            {track.duration ? ` · ${formatDuration(track.duration)}` : ""}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="rounded-full p-1.5 text-text-muted hover:text-text-primary hover:bg-text-primary/5 transition-colors"
        onClick={onRemove}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function PlaylistComposerTrackList({
  tracks,
  t,
  onDragEnd,
  onRemove,
}: {
  tracks: PlaylistComposerTrack[];
  t: ReturnType<typeof useTranslation>["t"];
  onDragEnd: (event: DragEndEvent) => void;
  onRemove: (track: PlaylistComposerTrack) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {t("common.tracks")}
          </h3>
          <p className="text-xs text-text-muted">
            {tracks.length > 0
              ? t("playlistComposer.selectedCount", { count: tracks.length })
              : t("playlistComposer.addTracksLater")}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border-quiet bg-text-primary/5">
        <div className="max-h-64 overflow-y-auto py-1.5">
          {tracks.length > 0 ? (
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={tracks.map(getTrackKey)}
                strategy={verticalListSortingStrategy}
              >
                {tracks.map((track) => (
                  <SortableTrackItem
                    key={getTrackKey(track)}
                    track={track}
                    onRemove={() => onRemove(track)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-text-muted">
              Start by searching for tracks or open this modal from an album or
              track menu.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
