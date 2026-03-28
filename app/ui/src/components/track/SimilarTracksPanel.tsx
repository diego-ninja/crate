import { useState, useEffect } from "react";
import { X, Loader2, Play } from "lucide-react";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import { usePlayerActions } from "@/contexts/PlayerContext";

interface SimilarTrack {
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  score: number | null;
}

interface SimilarTracksPanelProps {
  trackPath: string;
  trackTitle: string;
  artist: string;
  open: boolean;
  onClose: () => void;
}

export function SimilarTracksPanel({
  trackPath,
  trackTitle,
  artist,
  open,
  onClose,
}: SimilarTracksPanelProps) {
  const [tracks, setTracks] = useState<SimilarTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const { play } = usePlayerActions();

  useEffect(() => {
    if (!open || !trackPath) return;
    setLoading(true);
    api<{ tracks: SimilarTrack[] }>(
      `/api/similar-tracks?path=${encodeURIComponent(trackPath)}&limit=20`,
    )
      .then((d) => setTracks(d.tracks || []))
      .catch(() => setTracks([]))
      .finally(() => setLoading(false));
  }, [open, trackPath]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl w-[500px] max-h-[600px] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold">Similar to "{trackTitle}"</h3>
            <p className="text-xs text-muted-foreground">{artist}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto max-h-[500px]">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-primary" />
            </div>
          )}
          {!loading && tracks.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No similar tracks found
            </div>
          )}
          {tracks.map((t, i) => (
            <button
              key={t.path || i}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left group"
              onClick={() => {
                play({
                  id: t.path,
                  title: t.title || "Unknown",
                  artist: t.artist || artist,
                  album: t.album,
                  albumCover: t.album
                    ? `/api/cover/${encPath(t.artist)}/${encPath(t.album)}`
                    : undefined,
                });
              }}
            >
              <div className="w-8 text-center text-xs text-muted-foreground/40">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{t.title || "Unknown"}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {t.artist} — {t.album}
                </div>
              </div>
              {t.score != null && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div className="w-16 h-1.5 bg-primary/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.round(t.score * 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground font-mono">
                    {Math.round(t.score * 100)}%
                  </span>
                </div>
              )}
              <Play
                size={14}
                className="text-muted-foreground/30 group-hover:text-primary flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
