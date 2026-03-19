import { useRef } from "react";
import { useNavigate } from "react-router";
import { useApi } from "@/hooks/use-api";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { encPath } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface TimelineAlbum {
  artist: string;
  album: string;
  tracks: number;
}

type TimelineData = Record<string, TimelineAlbum[]>;

export function Timeline() {
  const { data, loading } = useApi<TimelineData>("/api/timeline");
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Library Timeline</h1>
        <GridSkeleton count={6} columns="grid-cols-6" />
      </div>
    );
  }

  if (!data || Object.keys(data).length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Library Timeline</h1>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 size={16} className="animate-spin" />
          <span>Timeline data is being computed...</span>
        </div>
      </div>
    );
  }

  const years = Object.entries(data);
  const maxAlbums = Math.max(...years.map(([, albums]) => albums.length));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Library Timeline</h1>
      <p className="text-sm text-muted-foreground mb-6">
        {years.length} years, {years.reduce((sum, [, a]) => sum + a.length, 0)} albums
      </p>

      <div
        ref={scrollRef}
        className="overflow-x-auto pb-4"
      >
        <div className="flex gap-1 items-end" style={{ minHeight: "400px" }}>
          {years.map(([year, albums]) => {
            const height = Math.max(60, (albums.length / maxAlbums) * 360);
            return (
              <div key={year} className="flex flex-col items-center flex-shrink-0" style={{ width: "64px" }}>
                <div
                  className="w-full flex flex-col gap-0.5 items-center justify-end overflow-hidden rounded-t-md bg-secondary/50 border border-border/50 px-0.5 pb-1"
                  style={{ height: `${height}px` }}
                >
                  {albums.slice(0, 8).map((album, i) => (
                    <button
                      key={`${album.artist}-${album.album}-${i}`}
                      onClick={() => navigate(`/album/${encPath(album.artist)}/${encPath(album.album)}`)}
                      title={`${album.artist} - ${album.album} (${album.tracks} tracks)`}
                      className="w-10 h-10 rounded flex-shrink-0 overflow-hidden bg-card border border-border/30 hover:border-primary transition-colors"
                    >
                      <img
                        src={`/api/cover/${encPath(album.artist)}/${encPath(album.album)}`}
                        alt={album.album}
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </button>
                  ))}
                  {albums.length > 8 && (
                    <div className="text-[10px] text-muted-foreground">
                      +{albums.length - 8}
                    </div>
                  )}
                </div>
                <div className="text-[11px] font-medium text-muted-foreground mt-1.5">{year}</div>
                <div className="text-[10px] text-muted-foreground/70">{albums.length}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
