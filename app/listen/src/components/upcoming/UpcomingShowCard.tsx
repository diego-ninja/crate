import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar } from "@crate/ui/icons";

import {
  ItemActionMenu,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { useShowActionEntries } from "@/components/actions/show-actions";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
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
  featured = false,
  showClose = true,
}: {
  item: UpcomingItem;
  expanded: boolean;
  onToggle: () => void;
  onAttendanceChange?: (attending: boolean) => void;
  featured?: boolean;
  showClose?: boolean;
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
  const menuCoverUrl = resolveMaybeApiAssetUrl(item.cover_url);
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
    ? measuredHeight > 0
      ? measuredHeight
      : "auto"
    : COLLAPSED_HEIGHT;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border",
        expanded
          ? cn(
              featured
                ? "border-accent-action/25 shadow-accent-action-card-featured"
                : "border-accent-action/20 shadow-accent-action-card",
              "transition-[height,border-color,box-shadow] duration-400 ease-out",
            )
          : "border-text-primary/[0.06] bg-text-primary/[0.02] transition-[height,border-color] duration-300 ease-out hover:border-accent-action/15 hover:bg-text-primary/[0.03]",
      )}
      style={{ height: cardHeight }}
      role={!expanded ? "button" : undefined}
      tabIndex={!expanded ? 0 : undefined}
      aria-expanded={!expanded ? expanded : undefined}
      onClick={!expanded ? onToggle : undefined}
      onKeyDown={
        !expanded && onToggle
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggle();
              }
            }
          : undefined
      }
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
            showClose={showClose}
          />
        )}
      </div>
      <ItemActionMenu
        actions={menuActions}
        header={{
          type: "media",
          title: item.artist,
          subtitle: item.title,
          detail: item.subtitle,
          imageUrl: menuCoverUrl,
          imageAlt: item.artist,
          imageShape: "square",
          fallbackIcon: Calendar,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}
