import { useMemo } from "react";
import { X } from "lucide-react";

import { ItemActionMenu, ItemActionMenuButton, type ItemActionMenuEntry, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import type { Track } from "@/contexts/PlayerContext";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";

interface QueuePanelProps {
  open: boolean;
  onClose: () => void;
}

function QueuePanelRow({
  track,
  indexLabel,
  onJump,
  onRemove,
  faded = false,
}: {
  track: Track;
  indexLabel: string;
  onJump: () => void;
  onRemove?: () => void;
  faded?: boolean;
}) {
  const menuTrack = useMemo(() => trackToMenuData(track), [track]);
  const baseActions = useTrackActionEntries({
    track: menuTrack,
    albumCover: track.albumCover,
    // In a queue context "Play now" must jump to this position, not reset the queue.
    onPlayNowOverride: onJump,
  });
  const actions = useMemo<ItemActionMenuEntry[]>(() => {
    if (!onRemove) return baseActions;
    return [
      ...baseActions,
      { type: "divider", key: `queue-remove-divider-${track.id}-${indexLabel}` },
      {
        key: `queue-remove-${track.id}-${indexLabel}`,
        label: "Remove from queue",
        icon: X,
        danger: true,
        onSelect: onRemove,
      },
    ];
  }, [baseActions, indexLabel, onRemove, track.id]);
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onJump}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onJump();
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      className={`group flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${faded ? "opacity-50" : ""}`}
    >
      <span className={`w-5 shrink-0 text-right text-[11px] tabular-nums ${faded ? "text-white/15" : "text-white/20"}`}>
        {indexLabel}
      </span>
      {track.albumCover ? (
        <img src={track.albumCover} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-8 w-8 shrink-0 rounded bg-white/10" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`min-w-0 flex-1 truncate text-[12px] ${faded ? "text-white/50" : "text-white/80"}`}>{track.title}</p>
          {track.isSuggested ? (
            <span className="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-primary">
              Suggested
            </span>
          ) : null}
        </div>
        <p className={`truncate text-[10px] ${faded ? "text-white/40" : "text-muted-foreground"}`}>{track.artist}</p>
      </div>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className="h-9 w-9 shrink-0 opacity-80 transition-opacity hover:opacity-100"
      />
      <ItemActionMenu
        actions={actions}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}

export function QueuePanel({ open, onClose }: QueuePanelProps) {
  const { isPlaying } = usePlayer();
  const { queue, currentIndex, jumpTo, removeFromQueue, currentTrack } = usePlayerActions();

  if (!open) return null;

  const upcoming = queue.slice(currentIndex + 1);
  const played = queue.slice(0, currentIndex);

  return (
    <div className="z-app-player-drawer fixed right-0 top-0 bottom-[72px] flex w-[360px] animate-in slide-in-from-right flex-col border-l border-white/5 bg-panel-surface shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h2 className="text-sm font-bold text-white">Queue</h2>
        <button onClick={onClose} aria-label="Close queue" className="p-1 text-white/40 hover:text-white transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Now Playing */}
      {currentTrack && (
        <div className="px-4 py-3 border-b border-white/5">
          <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">Now Playing</p>
          <div className="flex items-center gap-3">
            {currentTrack.albumCover ? (
              <img src={currentTrack.albumCover} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded bg-white/10 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-primary truncate">{currentTrack.title}</p>
              <p className="text-[11px] text-muted-foreground truncate">{currentTrack.artist}</p>
            </div>
            {isPlaying && (
              <div className="flex gap-0.5 items-end h-4">
                <div className="w-[3px] bg-primary rounded-sm equalizer-bar" style={{ animationDelay: "0ms" }} />
                <div className="w-[3px] bg-primary rounded-sm equalizer-bar" style={{ animationDelay: "200ms" }} />
                <div className="w-[3px] bg-primary rounded-sm equalizer-bar" style={{ animationDelay: "400ms" }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Upcoming */}
      <div className="flex-1 overflow-y-auto">
        {upcoming.length > 0 && (
          <div className="px-4 pt-3">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">
              Next up ({upcoming.length})
            </p>
          </div>
        )}
        {upcoming.map((track, i) => {
          const idx = currentIndex + 1 + i;
          return (
            <QueuePanelRow
              key={`${track.id}-${idx}`}
              track={track}
              indexLabel={String(i + 1)}
              onJump={() => jumpTo(idx)}
              onRemove={() => removeFromQueue(idx)}
            />
          );
        })}

        {upcoming.length === 0 && (
          <div className="px-4 py-8 text-center text-white/20 text-sm">
            Queue is empty
          </div>
        )}

        {/* Previously played */}
        {played.length > 0 && (
          <>
            <div className="px-4 pt-4">
              <p className="text-[10px] font-bold text-white/20 uppercase tracking-wider mb-2">
                Previously played
              </p>
            </div>
            {played.map((track, i) => (
              <QueuePanelRow
                key={`${track.id}-prev-${i}`}
                track={track}
                indexLabel={String(i + 1)}
                onJump={() => jumpTo(i)}
                faded
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
