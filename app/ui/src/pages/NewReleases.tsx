import { useState, useEffect } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2, Download, X, RefreshCw, Disc3, Sparkles, List, LayoutGrid } from "lucide-react";
import { ErrorState } from "@/components/ui/error-state";

interface Release {
  id: number;
  artist_name: string;
  album_title: string;
  tidal_id: string;
  tidal_url: string;
  cover_url: string;
  year: string;
  release_date: string | null;
  release_type: string | null;
  tracks: number;
  quality: string;
  status: string;
  detected_at: string;
  downloaded_at: string | null;
}

// ── Timeline subcomponents ────────────────────────────────────────

function ReleaseRow({ release: r, onDownload, onDismiss }: {
  release: Release;
  onDownload: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const day = r.release_date ? new Date(r.release_date + "T12:00:00").getDate() : null;
  const monthShort = r.release_date
    ? new Date(r.release_date + "T12:00:00").toLocaleDateString("en-US", { month: "short" }).toUpperCase()
    : null;

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-card/80 transition-colors group">
      {/* Date column */}
      <div className="w-12 text-center flex-shrink-0">
        {day ? (
          <>
            <div className="text-[10px] text-muted-foreground/50">{monthShort}</div>
            <div className="text-lg font-bold text-muted-foreground/70">{day}</div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground/30">--</div>
        )}
      </div>

      {/* Cover */}
      <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-secondary">
        {r.cover_url ? (
          <img src={r.cover_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 size={16} className="text-muted-foreground/30" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{r.album_title}</div>
        <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
          <Link to={`/artist/${encPath(r.artist_name)}`} className="hover:text-foreground transition-colors">
            {r.artist_name}
          </Link>
          {r.release_type && (
            <Badge variant="outline" className="text-[9px] px-1 py-0">{r.release_type}</Badge>
          )}
          {r.quality && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 border-green-500/30 text-green-500">{r.quality}</Badge>
          )}
        </div>
      </div>

      {/* Status / Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {r.status === "downloaded" && (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]">Downloaded</Badge>
        )}
        {r.status === "downloading" && (
          <Loader2 size={14} className="animate-spin text-primary" />
        )}
        {r.status === "detected" && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {r.tidal_url && (
              <Button size="sm" variant="outline" className="h-7 text-xs border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                onClick={() => onDownload(r.id)}>
                <Download size={12} className="mr-1" /> Download
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
              onClick={() => onDismiss(r.id)}>
              <X size={12} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function MonthGroup({ month, releases, onDownload, onDismiss }: {
  month: string;
  releases: Release[];
  onDownload: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const label = new Date(month + "-01T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="mb-6">
      <div className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider mb-3 border-b border-border/50 pb-1">
        {label}
      </div>
      <div className="space-y-2">
        {releases.map((r) => (
          <ReleaseRow key={r.id} release={r} onDownload={onDownload} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

function TimelineView({ releases, onDownload, onDismiss }: {
  releases: Release[];
  onDownload: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const upcoming = releases.filter((r) => r.release_date && r.release_date >= today);
  const recent = releases.filter((r) => !r.release_date || r.release_date < today);

  function groupByMonth(items: Release[]): Map<string, Release[]> {
    const groups = new Map<string, Release[]>();
    for (const r of items) {
      const date = r.release_date || r.detected_at?.slice(0, 10) || "Unknown";
      const month = date.slice(0, 7);
      const list = groups.get(month) || [];
      list.push(r);
      groups.set(month, list);
    }
    return groups;
  }

  const upcomingGroups = groupByMonth(upcoming);
  const recentGroups = groupByMonth(recent);

  return (
    <div className="space-y-8">
      {upcoming.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4">
            Upcoming
          </h2>
          {[...upcomingGroups.entries()].map(([month, items]) => (
            <MonthGroup key={month} month={month} releases={items}
              onDownload={onDownload} onDismiss={onDismiss} />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Recently Released
          </h2>
          {[...recentGroups.entries()].map(([month, items]) => (
            <MonthGroup key={month} month={month} releases={items}
              onDownload={onDownload} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Grid subcomponent ─────────────────────────────────────────────

function GridView({ releases, onDownload, onDismiss }: {
  releases: Release[];
  onDownload: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {releases.map((r) => (
        <div key={r.id} className="bg-card border border-border rounded-lg overflow-hidden group">
          {/* Cover */}
          <div className="relative aspect-square bg-secondary">
            {r.cover_url ? (
              <img src={r.cover_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Disc3 size={32} className="text-muted-foreground/30" />
              </div>
            )}
            {r.status === "downloading" && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <Loader2 size={24} className="animate-spin text-primary" />
              </div>
            )}
            {r.status === "downloaded" && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <Badge className="bg-green-500 text-white">Downloaded</Badge>
              </div>
            )}
            {r.status === "detected" && (
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <Button size="sm" onClick={() => onDownload(r.id)}>
                  <Download size={14} className="mr-1" /> Download
                </Button>
                <Button size="sm" variant="ghost" className="text-white/70" onClick={() => onDismiss(r.id)}>
                  <X size={14} />
                </Button>
              </div>
            )}
          </div>
          {/* Info */}
          <div className="p-3">
            <div className="text-sm font-medium truncate">{r.album_title}</div>
            <div className="text-xs text-muted-foreground truncate">{r.artist_name}</div>
            <div className="flex items-center gap-1.5 mt-1">
              {r.year && <span className="text-[10px] text-muted-foreground">{r.year}</span>}
              {r.tracks > 0 && <span className="text-[10px] text-muted-foreground">{r.tracks} tracks</span>}
              {r.quality && (
                <Badge variant="outline" className="text-[9px] px-1 py-0">{r.quality}</Badge>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────

export function NewReleases() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [filter, setFilter] = useState<string>("detected");
  const [view, setView] = useState<"timeline" | "grid">("timeline");

  async function fetchReleases() {
    try {
      const data = await api<{ releases: Release[] }>(`/api/acquisition/new-releases?status=${filter}`);
      setReleases(data.releases || []);
      setError(null);
    } catch {
      setError("Failed to load releases");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchReleases(); }, [filter]);

  async function checkNow() {
    setChecking(true);
    try {
      const { task_id } = await api<{ task_id: string }>("/api/acquisition/new-releases/check", "POST");
      toast.success("Checking for new releases...");
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string }>(`/api/tasks/${task_id}`);
          if (task.status === "completed" || task.status === "failed") {
            clearInterval(poll);
            setChecking(false);
            if (task.status === "completed") {
              toast.success("Check complete");
              fetchReleases();
            }
          }
        } catch { /* poll */ }
      }, 5000);
      setTimeout(() => { clearInterval(poll); setChecking(false); }, 600000);
    } catch { setChecking(false); toast.error("Failed"); }
  }

  async function downloadRelease(id: number) {
    try {
      await api(`/api/acquisition/new-releases/${id}/download`, "POST");
      toast.success("Download started");
      setReleases((prev) => prev.map((r) => r.id === id ? { ...r, status: "downloading" } : r));
    } catch { toast.error("Download failed"); }
  }

  async function dismissRelease(id: number) {
    await api(`/api/acquisition/new-releases/${id}/dismiss`, "POST");
    setReleases((prev) => prev.filter((r) => r.id !== id));
  }

  if (error) return <ErrorState message={error} onRetry={fetchReleases} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Sparkles size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">New Releases</h1>
          {releases.length > 0 && (
            <Badge variant="outline" className="text-primary border-primary/30">
              {releases.length} new
            </Badge>
          )}
          <div className="flex items-center gap-1">
            <Button size="sm" variant={view === "timeline" ? "default" : "ghost"} className="h-7 px-2"
              onClick={() => setView("timeline")}>
              <List size={14} />
            </Button>
            <Button size="sm" variant={view === "grid" ? "default" : "ghost"} className="h-7 px-2"
              onClick={() => setView("grid")}>
              <LayoutGrid size={14} />
            </Button>
          </div>
        </div>
        <Button size="sm" onClick={checkNow} disabled={checking}>
          {checking ? <Loader2 size={14} className="animate-spin mr-1" /> : <RefreshCw size={14} className="mr-1" />}
          {checking ? "Checking..." : "Check Now"}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {["detected", "downloading", "downloaded", ""].map((s) => (
          <Button key={s || "all"} size="sm" variant={filter === s ? "default" : "outline"}
            onClick={() => setFilter(s)}>
            {s || "All"}
          </Button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {!loading && releases.length === 0 && (
        <div className="text-center py-24">
          <Disc3 size={48} className="text-primary mx-auto mb-3 opacity-30" />
          <div className="text-lg font-semibold">No new releases</div>
          <div className="text-sm text-muted-foreground mt-1">
            Click "Check Now" to scan for new albums from your library artists
          </div>
        </div>
      )}

      {!loading && releases.length > 0 && (
        view === "timeline" ? (
          <TimelineView releases={releases} onDownload={downloadRelease} onDismiss={dismissRelease} />
        ) : (
          <GridView releases={releases} onDownload={downloadRelease} onDismiss={dismissRelease} />
        )
      )}
    </div>
  );
}
