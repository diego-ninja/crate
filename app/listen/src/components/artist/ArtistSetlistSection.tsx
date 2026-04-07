import { Play } from "lucide-react";

interface ArtistSetlistSectionProps {
  artistName: string;
  setlist: { title: string; frequency: number; play_count: number; last_played?: string }[];
  onPlayAll: () => void;
}

export function ArtistSetlistSection({ setlist, onPlayAll }: ArtistSetlistSectionProps) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Probable Setlist</h2>
          <p className="text-xs text-muted-foreground">Based on recent concerts</p>
        </div>
        <button
          className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-white/5"
          onClick={onPlayAll}
        >
          <Play size={12} fill="currentColor" />
          Play All
        </button>
      </div>

      <div className="space-y-1">
        {setlist.map((track, i) => (
          <div
            key={`${track.title}-${i}`}
            className="flex items-center gap-3 rounded-lg px-2 py-1.5"
          >
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-white/25">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {track.title}
            </span>
            <div className="hidden w-24 items-center gap-2 sm:flex">
              <div className="relative h-1 flex-1 rounded-full bg-primary/15">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${Math.round(track.frequency * 100)}%` }}
                />
              </div>
              <span className="w-8 text-right text-[10px] tabular-nums text-white/30">
                {Math.round(track.frequency * 100)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
