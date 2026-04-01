import { X } from "lucide-react";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";

interface QueuePanelProps {
  open: boolean;
  onClose: () => void;
}

export function QueuePanel({ open, onClose }: QueuePanelProps) {
  const { isPlaying } = usePlayer();
  const { queue, currentIndex, jumpTo, removeFromQueue, currentTrack } = usePlayerActions();

  if (!open) return null;

  const upcoming = queue.slice(currentIndex + 1);
  const played = queue.slice(0, currentIndex);

  return (
    <div className="fixed right-0 top-0 bottom-[72px] w-[360px] bg-[#0c0c14] border-l border-white/5 z-50 flex flex-col shadow-2xl animate-in slide-in-from-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h2 className="text-sm font-bold text-white">Queue</h2>
        <button onClick={onClose} className="p-1 text-white/40 hover:text-white transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Now Playing */}
      {currentTrack && (
        <div className="px-4 py-3 border-b border-white/5">
          <p className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">Now Playing</p>
          <div className="flex items-center gap-3">
            {currentTrack.albumCover ? (
              <img src={currentTrack.albumCover} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded bg-white/10 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-primary truncate">{currentTrack.title}</p>
              <p className="text-[11px] text-white/50 truncate">{currentTrack.artist}</p>
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
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">
              Next up ({upcoming.length})
            </p>
          </div>
        )}
        {upcoming.map((track, i) => {
          const idx = currentIndex + 1 + i;
          return (
            <button
              key={`${track.id}-${idx}`}
              className="w-full flex items-center gap-3 px-4 py-2 hover:bg-white/5 transition-colors text-left group"
              onClick={() => jumpTo(idx)}
            >
              <span className="text-[11px] text-white/20 w-5 text-right tabular-nums shrink-0">{i + 1}</span>
              {track.albumCover ? (
                <img src={track.albumCover} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded bg-white/10 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[12px] text-white/80">{track.title}</p>
                  {track.isSuggested ? (
                    <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-cyan-300">
                      Suggested
                    </span>
                  ) : null}
                </div>
                <p className="text-[10px] text-white/40 truncate">{track.artist}</p>
              </div>
              <button
                className="p-1 text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                onClick={(e) => { e.stopPropagation(); removeFromQueue(idx); }}
                title="Remove"
              >
                <X size={12} />
              </button>
            </button>
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
              <button
                key={`${track.id}-prev-${i}`}
                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-white/5 transition-colors text-left opacity-50"
                onClick={() => jumpTo(i)}
              >
                <span className="text-[11px] text-white/15 w-5 text-right tabular-nums shrink-0">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[12px] text-white/50">{track.title}</p>
                    {track.isSuggested ? (
                      <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-cyan-300">
                        Suggested
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[10px] text-white/30 truncate">{track.artist}</p>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
