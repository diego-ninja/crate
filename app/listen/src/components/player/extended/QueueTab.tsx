import { useMemo } from "react";
import { Save, X } from "lucide-react";
import { toast } from "sonner";

import { ItemActionMenu, ItemActionMenuButton, type ItemActionMenuEntry, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { getPlaySourceLabel } from "@/components/player/player-source";
import { usePlayer, usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";

function QueueTabRow({
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
    onPlayNowOverride: onJump,
  });
  const actions = useMemo<ItemActionMenuEntry[]>(() => {
    if (!onRemove) return baseActions;
    return [
      ...baseActions,
      { type: "divider", key: `queue-tab-remove-divider-${track.id}-${indexLabel}` },
      {
        key: `queue-tab-remove-${track.id}-${indexLabel}`,
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
      className={`group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${faded ? "opacity-50" : ""}`}
    >
      <span className={`w-4 shrink-0 text-right text-[10px] tabular-nums ${faded ? "text-white/15" : "text-white/20"}`}>
        {indexLabel}
      </span>
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

export function QueueTab() {
  const { isPlaying } = usePlayer();
  const { queue, currentIndex, playSource, currentTrack, jumpTo, removeFromQueue } = usePlayerActions();

  const history = queue.slice(0, currentIndex).reverse();
  const upcoming = queue.slice(currentIndex + 1);
  const sourceName = getPlaySourceLabel(playSource) || "Queue";

  async function handleSaveAsPlaylist() {
    const validTracks = queue.filter((t) => t.path && t.path.includes("/"));
    if (!validTracks.length) {
      toast.error("No local tracks in queue to save");
      return;
    }
    try {
      await api("/api/playlists", "POST", {
        name: getPlaySourceLabel(playSource) || "Queue",
        tracks: validTracks.map((t) => ({
          path: t.path,
          title: t.title,
          artist: t.artist,
          album: t.album || "",
        })),
      });
      toast.success(`Playlist saved (${validTracks.length} tracks)`);
    } catch {
      toast.error("Failed to save playlist");
    }
  }

  return (
    <div className="flex-1 overflow-y-auto pr-1">
      {history.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-white/40">
            History
          </p>
          {history.map((track, i) => {
            const realIdx = currentIndex - 1 - i;
            return (
              <QueueTabRow
                key={`hist-${track.id}-${realIdx}`}
                track={track}
                indexLabel={String(realIdx + 1)}
                onJump={() => jumpTo(realIdx)}
                faded
              />
            );
          })}
        </div>
      )}

      {currentTrack && (
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">
              Now playing from: {sourceName}
            </p>
            {queue.length > 0 && (
              <button
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/5 hover:text-muted-foreground"
                onClick={() => void handleSaveAsPlaylist()}
                title="Save as Playlist"
              >
                <Save size={10} />
                Save
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-white/5 px-2 py-1.5">
            <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-primary">
              {currentIndex + 1}
            </span>
            {currentTrack.albumCover ? (
              <img src={currentTrack.albumCover} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded object-cover" />
            ) : (
              <div className="h-8 w-8 shrink-0 rounded bg-white/10" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium text-primary">{currentTrack.title}</p>
              <p className="truncate text-[10px] text-muted-foreground">{currentTrack.artist}</p>
            </div>
            {isPlaying && (
              <div className="flex h-4 shrink-0 items-end gap-0.5">
                <div className="equalizer-bar w-[3px] rounded-sm bg-primary" style={{ animationDelay: "0ms" }} />
                <div className="equalizer-bar w-[3px] rounded-sm bg-primary" style={{ animationDelay: "200ms" }} />
                <div className="equalizer-bar w-[3px] rounded-sm bg-primary" style={{ animationDelay: "400ms" }} />
              </div>
            )}
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div>
          <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-white/40">
            Next up from: {sourceName} ({upcoming.length})
          </p>
          {upcoming.map((track, i) => {
            const idx = currentIndex + 1 + i;
            return (
              <QueueTabRow
                key={`next-${track.id}-${idx}`}
                track={track}
                indexLabel={String(i + 1)}
                onJump={() => jumpTo(idx)}
                onRemove={() => removeFromQueue(idx)}
              />
            );
          })}
        </div>
      )}

      {upcoming.length === 0 && !currentTrack ? (
        <div className="py-12 text-center text-sm text-white/20">Queue is empty</div>
      ) : null}
    </div>
  );
}
