import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ItemActionMenu, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { useShowActionEntries } from "@/components/actions/show-actions";
import { cn } from "@/lib/utils";

import {
  UpcomingShowCollapsedView,
  UpcomingShowExpandedView,
} from "./UpcomingShowCardViews";
import type { UpcomingItem } from "./upcoming-model";
import { useUpcomingShowActions } from "./use-upcoming-show-actions";

const COLLAPSED_HEIGHT = 88;

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
  const menuActions = useShowActionEntries({
    item,
    attending,
    toggleAttendance,
    playProbableSetlist,
  });
  const actionMenu = useItemActionMenu(menuActions);
  const actionMenuSlot = useMemo(
    () => ({
      triggerRef: actionMenu.triggerRef,
      hasActions: actionMenu.hasActions,
      onOpen: actionMenu.openFromTrigger,
    }),
    [actionMenu.hasActions, actionMenu.openFromTrigger, actionMenu.triggerRef],
  );

  // Measure expanded content height for smooth animation
  const contentRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(0);

  const measure = useCallback(() => {
    if (contentRef.current) {
      setMeasuredHeight(contentRef.current.scrollHeight);
    }
  }, []);

  useEffect(() => {
    if (expanded) measure();
  }, [expanded, measure]);

  const cardHeight = expanded
    ? (measuredHeight > 0 ? measuredHeight : "auto")
    : COLLAPSED_HEIGHT;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border",
        expanded
          ? "border-primary/20 shadow-[0_12px_40px_rgba(6,182,212,0.10)] transition-[height,border-color,box-shadow] duration-400 ease-out"
          : "border-white/[0.06] bg-white/[0.02] transition-[height,border-color] duration-300 ease-out hover:border-primary/15 hover:bg-white/[0.03]",
      )}
      style={{ height: cardHeight }}
      onClick={!expanded ? onToggle : undefined}
      onContextMenu={actionMenu.handleContextMenu}
    >
      <div ref={contentRef}>
        {!expanded && <div className="absolute inset-0 bg-raised-surface" />}

        {!expanded ? (
          <UpcomingShowCollapsedView
            item={item}
            attending={attending}
            savingAttendance={savingAttendance}
            actionMenu={actionMenuSlot}
            onToggleAttendance={toggleAttendance}
          />
        ) : (
          <UpcomingShowExpandedView
            item={item}
            attending={attending}
            savingAttendance={savingAttendance}
            playingSetlist={playingSetlist}
            onToggleAttendance={toggleAttendance}
            onPlaySetlist={playProbableSetlist}
            onClose={onToggle}
          />
        )}
      </div>
      <ItemActionMenu
        actions={menuActions}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}
