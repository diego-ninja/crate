import { useState } from "react";
import { usePlayer } from "@/contexts/PlayerContext";
import { cn } from "@/lib/utils";
import { GripVertical, Music, Trash2 } from "lucide-react";

export function QueueList() {
  const { queue, currentIndex, jumpTo, removeFromQueue } = usePlayer();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  return (
    <div className="space-y-0.5 overflow-y-auto">
      {queue.map((track, i) => {
        const isCurrent = i === currentIndex;
        return (
          <div
            key={`${track.id}-${i}`}
            draggable={!isCurrent}
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            onDrop={() => { setDragIdx(null); setOverIdx(null); }}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors group",
              isCurrent ? "bg-primary/10 text-primary" : "hover:bg-white/5 cursor-pointer",
              overIdx === i && dragIdx !== null && dragIdx !== i && "border-t border-primary",
            )}
            onClick={() => jumpTo(i)}
          >
            {/* Drag handle */}
            {!isCurrent && (
              <GripVertical size={12} className="text-muted-foreground/40 flex-shrink-0 cursor-grab" />
            )}
            {isCurrent && (
              <div className="flex items-end gap-[2px] h-2.5 flex-shrink-0 w-3">
                <span className="equalizer-bar w-[2px] bg-primary rounded-sm" style={{ animationDelay: "0ms" }} />
                <span className="equalizer-bar w-[2px] bg-primary rounded-sm" style={{ animationDelay: "150ms" }} />
                <span className="equalizer-bar w-[2px] bg-primary rounded-sm" style={{ animationDelay: "300ms" }} />
              </div>
            )}

            {/* Cover thumb */}
            <div className="w-7 h-7 rounded overflow-hidden bg-secondary flex-shrink-0">
              {track.albumCover ? (
                <img src={track.albumCover} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Music size={10} className="text-muted-foreground/30" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <div className={cn("text-[11px] font-medium truncate", isCurrent && "text-primary")}>
                {track.title}
              </div>
              <div className="text-[9px] text-muted-foreground truncate">{track.artist}</div>
            </div>

            {/* Remove */}
            {!isCurrent && (
              <button
                onClick={(e) => { e.stopPropagation(); removeFromQueue(i); }}
                className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-red-400 transition-opacity flex-shrink-0"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
