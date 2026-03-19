import { usePlayer, type Track } from "@/contexts/PlayerContext";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Music } from "lucide-react";

interface QueuePanelProps {
  queue: Track[];
  currentIndex: number;
  onClose: () => void;
}

export function QueuePanel({ queue, currentIndex, onClose }: QueuePanelProps) {
  const { jumpTo } = usePlayer();

  return (
    <div className="fixed bottom-16 right-0 w-80 max-h-[60vh] z-50 bg-card border border-border rounded-tl-lg shadow-xl animate-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold">Queue ({queue.length})</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>
      <ScrollArea className="max-h-[calc(60vh-48px)]">
        <div className="p-2">
          {queue.map((track, i) => (
            <button
              key={`${track.id}-${i}`}
              onClick={() => jumpTo(i)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors hover:bg-secondary ${
                i === currentIndex ? "bg-primary/10 text-primary" : ""
              }`}
            >
              {track.albumCover ? (
                <img src={track.albumCover} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center flex-shrink-0">
                  <Music size={12} className="text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className={`text-xs font-medium truncate ${i === currentIndex ? "text-primary" : ""}`}>
                  {track.title}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">{track.artist}</div>
              </div>
              {i === currentIndex && (
                <div className="flex items-end gap-[2px] h-3 flex-shrink-0">
                  <span className="equalizer-bar w-[2px] bg-primary rounded-sm" style={{ animationDelay: "0ms" }} />
                  <span className="equalizer-bar w-[2px] bg-primary rounded-sm" style={{ animationDelay: "150ms" }} />
                  <span className="equalizer-bar w-[2px] bg-primary rounded-sm" style={{ animationDelay: "300ms" }} />
                </div>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
