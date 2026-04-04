import { X } from "lucide-react";

import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";

export function QueueTab() {
  const { isPlaying } = usePlayer();
  const { queue, currentIndex, playSource, currentTrack, jumpTo, removeFromQueue } = usePlayerActions();

  const history = queue.slice(0, currentIndex).reverse();
  const upcoming = queue.slice(currentIndex + 1);
  const sourceName = playSource?.name || "Queue";

  return (
    <div className="flex-1 overflow-y-auto pr-1">
      {history.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-white/25">
            History
          </p>
          {history.map((track, i) => {
            const realIdx = currentIndex - 1 - i;
            return (
              <button
                key={`hist-${track.id}-${realIdx}`}
                onClick={() => jumpTo(realIdx)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left opacity-50 transition-colors hover:bg-white/5"
              >
                <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-white/15">
                  {realIdx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[12px] text-white/50">{track.title}</p>
                    {track.isSuggested ? (
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-primary">
                        Suggested
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-[10px] text-white/25">{track.artist}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {currentTrack && (
        <div className="mb-4">
          <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-white/25">
            Now playing from: {sourceName}
          </p>
          <div className="flex items-center gap-3 rounded-lg bg-white/5 px-2 py-1.5">
            <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-primary">
              {currentIndex + 1}
            </span>
            {currentTrack.albumCover ? (
              <img src={currentTrack.albumCover} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
            ) : (
              <div className="h-8 w-8 shrink-0 rounded bg-white/10" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium text-primary">{currentTrack.title}</p>
              <p className="truncate text-[10px] text-white/50">{currentTrack.artist}</p>
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
          <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-white/25">
            Next up from: {sourceName} ({upcoming.length})
          </p>
          {upcoming.map((track, i) => {
            const idx = currentIndex + 1 + i;
            return (
              <div
                key={`next-${track.id}-${idx}`}
                onClick={() => jumpTo(idx)}
                className="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
              >
                <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-white/20">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[12px] text-white/80">{track.title}</p>
                    {track.isSuggested ? (
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-primary">
                        Suggested
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-[10px] text-white/40">{track.artist}</p>
                </div>
                <button
                  className="shrink-0 p-1 text-white/20 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeFromQueue(idx);
                  }}
                  title="Remove"
                >
                  <X size={12} />
                </button>
              </div>
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
