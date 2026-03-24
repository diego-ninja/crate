import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useApi } from "@/hooks/use-api";
import { useTaskEvents } from "@/hooks/use-task-events";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2, Image, CheckCircle2, Search,
  Download, Disc3, Zap,
} from "lucide-react";

interface CoverFoundEvent {
  artist: string;
  album: string;
  path: string;
  source: string;
  size: number;
  index: number;
}

const SOURCE_LABELS: Record<string, string> = {
  coverartarchive: "Cover Art Archive",
  embedded: "Embedded in Audio",
  deezer: "Deezer",
  itunes: "iTunes",
  lastfm: "Last.fm",
  tidal: "Tidal",
};

const SOURCE_COLORS: Record<string, string> = {
  coverartarchive: "text-green-500 border-green-500/30",
  embedded: "text-blue-500 border-blue-500/30",
  deezer: "text-purple-500 border-purple-500/30",
  itunes: "text-pink-500 border-pink-500/30",
  lastfm: "text-red-500 border-red-500/30",
  tidal: "text-cyan-500 border-cyan-500/30",
};

export function Artwork() {
  const navigate = useNavigate();
  const { data: missingData } = useApi<{ missing_count: number; albums: { name: string; display_name: string; artist: string; year: string; mbid: string | null; path: string }[] }>("/api/artwork/missing");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [applying, setApplying] = useState<Set<number>>(new Set());
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const { events, done, connected } = useTaskEvents(taskId);

  const isScanning = taskId !== null && !done;

  // Extract cover_found events
  const coverEvents = events
    .filter((e) => e.type === "cover_found")
    .map((e) => e.data as unknown as CoverFoundEvent);

  const infoEvents = events.filter((e) => e.type === "info");
  const lastInfo = infoEvents[infoEvents.length - 1];

  async function startScan(autoApply = false) {
    try {
      const { task_id } = await api<{ task_id: string }>("/api/artwork/scan", "POST", { auto_apply: autoApply });
      setTaskId(task_id);
      setApplied(new Set());
      setApplying(new Set());
      toast.success(autoApply ? "Scanning + auto-applying covers..." : "Scanning for missing covers...");
    } catch {
      toast.error("Failed to start scan");
    }
  }

  async function applyCover(cover: CoverFoundEvent) {
    setApplying((prev) => new Set(prev).add(cover.index));
    try {
      await api("/api/artwork/apply", "POST", {
        path: cover.path,
        source: cover.source,
        artist: cover.artist,
        album: cover.album,
        mbid: "",
      });
      setApplied((prev) => new Set(prev).add(cover.index));
      toast.success(`Cover applied: ${cover.artist} — ${cover.album}`);
    } catch {
      toast.error("Failed to apply cover");
    } finally {
      setApplying((prev) => { const s = new Set(prev); s.delete(cover.index); return s; });
    }
  }

  async function applyAll() {
    for (const cover of coverEvents) {
      if (!applied.has(cover.index)) {
        await applyCover(cover);
      }
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Image size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">Album Art Manager</h1>
          {missingData && (
            <Badge variant="outline" className={missingData.missing_count > 0 ? "text-yellow-500 border-yellow-500/30" : "text-green-500 border-green-500/30"}>
              {missingData.missing_count} missing
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => startScan(false)} disabled={isScanning}>
            {isScanning ? <Loader2 size={14} className="animate-spin mr-1" /> : <Search size={14} className="mr-1" />}
            Scan & Find Covers
          </Button>
          <Button variant="outline" onClick={() => startScan(true)} disabled={isScanning}>
            <Zap size={14} className="mr-1" /> Auto-Apply All
          </Button>
        </div>
      </div>

      {/* Scanning progress */}
      {isScanning && (
        <Card className="p-4 mb-6 border-blue-500/20 bg-blue-500/5">
          <div className="flex items-center gap-3">
            <Loader2 size={16} className="animate-spin text-blue-500" />
            <div className="flex-1">
              <div className="text-sm font-medium">
                {lastInfo?.data?.message as string ?? "Scanning..."}
              </div>
              {connected && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {coverEvents.length} covers found so far
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Done summary */}
      {done && (
        <Card className="p-4 mb-6 border-green-500/20 bg-green-500/5">
          <div className="flex items-center gap-3">
            <CheckCircle2 size={16} className="text-green-500" />
            <div className="flex-1">
              <div className="text-sm font-medium">Scan complete</div>
              <div className="text-xs text-muted-foreground">
                {coverEvents.length} covers found · {applied.size} applied
              </div>
            </div>
            {coverEvents.length > 0 && applied.size < coverEvents.length && (
              <Button size="sm" onClick={applyAll}>
                <Download size={14} className="mr-1" /> Apply All ({coverEvents.length - applied.size})
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Cover suggestions — live as they arrive */}
      {coverEvents.length > 0 && (
        <div className="space-y-2">
          {coverEvents.map((cover) => {
            const isApplied = applied.has(cover.index);
            const isApplying = applying.has(cover.index);
            return (
              <div
                key={`${cover.artist}-${cover.album}-${cover.index}`}
                className={`flex items-center gap-4 px-4 py-3 rounded-lg border border-border transition-opacity ${isApplied ? "opacity-50" : ""}`}
              >
                {/* Cover preview */}
                <div className="w-12 h-12 rounded-lg bg-secondary flex-shrink-0 overflow-hidden">
                  <img
                    src={`/api/cover/${encPath(cover.artist)}/${encPath(cover.album)}`}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    <button
                      className="hover:text-primary transition-colors"
                      onClick={() => navigate(`/album/${encPath(cover.artist)}/${encPath(cover.album)}`)}
                    >
                      {cover.artist} — {cover.album}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${SOURCE_COLORS[cover.source] || ""}`}>
                      {SOURCE_LABELS[cover.source] || cover.source}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {Math.round(cover.size / 1024)}KB
                    </span>
                  </div>
                </div>

                {/* Actions */}
                {isApplied ? (
                  <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" />
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isApplying}
                    onClick={() => applyCover(cover)}
                  >
                    {isApplying ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} className="mr-1" />}
                    {isApplying ? "" : "Apply"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* No results */}
      {done && coverEvents.length === 0 && (
        <div className="text-center py-12">
          <Disc3 size={48} className="text-green-500 mx-auto mb-3 opacity-50" />
          <div className="text-lg font-semibold text-green-500">All albums have cover art!</div>
          <div className="text-sm text-muted-foreground mt-1">No missing covers found</div>
        </div>
      )}

      {/* Missing albums list (before scan) */}
      {!taskId && !done && missingData && missingData.albums && missingData.albums.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3">Missing Covers ({missingData.missing_count})</h3>
          <div className="space-y-1">
            {missingData.albums.map((a, i) => (
              <div key={`${a.artist}-${a.name}-${i}`} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border hover:bg-muted/30 transition-colors">
                <div className="w-10 h-10 rounded bg-secondary flex items-center justify-center flex-shrink-0">
                  <Disc3 size={16} className="text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <button
                    className="text-sm font-medium truncate hover:text-primary transition-colors block"
                    onClick={() => navigate(`/album/${encPath(a.artist)}/${encPath(a.name)}`)}
                  >
                    {a.artist} — {a.display_name}
                  </button>
                  <div className="text-xs text-muted-foreground flex gap-2">
                    {a.year && <span>{a.year}</span>}
                    {a.mbid ? (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 text-green-500 border-green-500/30">MBID</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 text-yellow-500 border-yellow-500/30">No MBID</Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!taskId && !done && (!missingData || missingData.missing_count === 0) && (
        <div className="text-center py-12 text-muted-foreground">
          <Image size={48} className="mx-auto mb-3 opacity-30" />
          <div className="text-sm">All albums have cover art!</div>
        </div>
      )}
    </div>
  );
}
