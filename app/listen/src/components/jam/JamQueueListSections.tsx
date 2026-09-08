import { type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  ListMusic,
  Search,
  Trash2,
} from "@crate/ui/icons";
import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { CrateImage } from "@/components/artwork/CrateImage";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { Button } from "@crate/ui/shadcn/button";

import type { JamQueuePanelProps } from "./JamQueueSections";

const jamQueueItemClassName =
  "jam-queue-item flex items-center gap-3 rounded-lg px-3 py-3";

function SortableJamQueueItem({
  id,
  dragLabel,
  children,
}: {
  id: string;
  dragLabel: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
      className={jamQueueItemClassName}
    >
      <button
        type="button"
        aria-label={dragLabel}
        title={dragLabel}
        className="shrink-0 touch-none cursor-grab text-text-muted/60 hover:text-text-primary active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      {children}
    </div>
  );
}

function JamQueueItemShell({
  sortable,
  id,
  dragLabel,
  children,
}: {
  sortable: boolean;
  id: string;
  dragLabel: string;
  children: ReactNode;
}) {
  if (sortable) {
    return (
      <SortableJamQueueItem id={id} dragLabel={dragLabel}>
        {children}
      </SortableJamQueueItem>
    );
  }
  return <div className={jamQueueItemClassName}>{children}</div>;
}

type JamQueueListProps = Pick<
  JamQueuePanelProps,
  | "t"
  | "room"
  | "queueMode"
  | "queueItems"
  | "queueSensors"
  | "handleQueueDragEnd"
  | "canManageQueue"
  | "isConnected"
  | "handleVote"
  | "handleMoveInRoomQueue"
  | "handleRemoveFromRoomQueue"
  | "focusQueueSearch"
  | "queuePrimaryActionLabel"
>;

export function JamQueueList(props: JamQueueListProps) {
  const {
    t,
    room,
    queueMode,
    queueItems,
    queueSensors,
    handleQueueDragEnd,
    canManageQueue,
    isConnected,
    handleVote,
    handleMoveInRoomQueue,
    handleRemoveFromRoomQueue,
    focusQueueSearch,
    queuePrimaryActionLabel,
  } = props;

  return (
    <div
      data-testid="jam-shared-queue-list"
      className="mt-4 max-h-[min(42rem,calc(100vh-18rem))] space-y-3 overflow-y-auto overscroll-contain pr-1"
    >
      <DndContext
        collisionDetection={closestCenter}
        sensors={queueSensors}
        onDragEnd={handleQueueDragEnd}
      >
        <SortableContext
          items={queueItems.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {queueItems.map((item, index) => {
            const track = item.track;
            return (
              <JamQueueItemShell
                key={item.id}
                sortable={canManageQueue}
                id={item.id}
                dragLabel={t("jam.room.queueDragAria", {
                  title: track.title,
                })}
              >
                <div className="jam-subtle-text w-6 text-center text-xs">
                  {index + 1}
                </div>
                {track.albumCover ? (
                  <CrateImage
                    src={track.albumCover}
                    alt=""
                    className=" size-10 rounded-lg object-cover"
                  />
                ) : (
                  <div className="jam-artwork-placeholder flex size-10 items-center justify-center rounded-lg">
                    <ListMusic size={15} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text-primary">
                    {track.title}
                  </div>
                  <div className="truncate text-xs text-text-muted">
                    {track.artist}
                    {track.album ? ` · ${track.album}` : ""}
                  </div>
                </div>
                {["auto", "auto_dj"].includes(queueMode) &&
                (queueMode !== "auto_dj" || room.auto_dj_voting !== false) ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <FollowHeartButton
                      following={item.voted_by_me}
                      disabled={item.voted_by_me || !isConnected}
                      onClick={() => handleVote(item)}
                      aria-label={t(
                        item.voted_by_me
                          ? "jam.room.queueVotedAria"
                          : "jam.room.queueVoteAria",
                        {
                          title: track.title,
                        },
                      )}
                      title={t(
                        item.voted_by_me
                          ? "jam.room.queueVotedAria"
                          : "jam.room.queueVoteAria",
                        {
                          title: track.title,
                        },
                      )}
                      iconSize={18}
                      className="rounded-full p-1 text-text-muted transition-colors hover:bg-surface-quiet-subtle disabled:cursor-default disabled:opacity-45"
                    />
                    <span
                      aria-label={t("jam.room.queueVoteCount", {
                        count: item.vote_count,
                      })}
                      className="min-w-4 text-center text-xs tabular-nums text-text-muted"
                    >
                      {item.vote_count}
                    </span>
                  </div>
                ) : null}
                {canManageQueue ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={t("jam.room.queueMoveUpAria", {
                        title: track.title,
                      })}
                      onClick={() =>
                        handleMoveInRoomQueue(item.id, index, index - 1)
                      }
                      disabled={index === 0}
                      className="jam-chip rounded-full p-1.5 text-text-muted hover:bg-surface-quiet-subtle disabled:opacity-30"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={t("jam.room.queueMoveDownAria", {
                        title: track.title,
                      })}
                      onClick={() =>
                        handleMoveInRoomQueue(item.id, index, index + 1)
                      }
                      disabled={index === queueItems.length - 1}
                      className="jam-chip rounded-full p-1.5 text-text-muted hover:bg-surface-quiet-subtle disabled:opacity-30"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={t("jam.room.queueRemoveAria", {
                        title: track.title,
                      })}
                      onClick={() => handleRemoveFromRoomQueue(item.id)}
                      className="jam-danger-control rounded-full p-1.5"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ) : null}
              </JamQueueItemShell>
            );
          })}
        </SortableContext>
      </DndContext>
      {queueItems.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-text-muted">
            {t("jam.room.emptyQueuePrefix")} <b>{queuePrimaryActionLabel}</b>{" "}
            {t("jam.room.emptyQueueSuffix")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={focusQueueSearch}
            className="jam-secondary-action inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-text-primary transition-colors"
          >
            <Search size={15} />
            {t("jam.room.browseLibrary")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
