import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { CrateChip, CratePill } from "@crate-ui/primitives/CrateBadge";
import { Button } from "@crate-ui/shadcn/button";
import { Input } from "@crate-ui/shadcn/input";
import { Badge } from "@crate-ui/shadcn/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@crate-ui/shadcn/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@crate-ui/shadcn/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate-ui/shadcn/select";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { toast } from "sonner";
import {
  Search, Download, Disc3, Music, Users, Loader2,
  CheckCircle2, Heart, Clock, XCircle,
  Trash2, ArrowUp, RotateCcw, Upload, ArrowLeft,
  Gauge, Zap, List,
} from "lucide-react";
// encPath available if needed for navigation

interface TidalAlbum {
  id: string;
  title: string;
  artist: string;
  year: string;
  tracks: number;
  cover: string | null;
  url: string;
  quality: string[];
}

interface TidalTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  url: string;
  quality: string[];
}

interface TidalArtist {
  id: string;
  name: string;
  picture: string | null;
}

interface SearchResult {
  albums?: TidalAlbum[];
  artists?: TidalArtist[];
  tracks?: TidalTrack[];
}

interface SoulseekResult {
  username: string;
  speed: number;
  freeSlot: boolean;
  album: string;
  artist: string;
  files: { filename: string; size: number; length: number; extension: string; bitDepth?: number; sampleRate?: number }[];
  quality: string;
  totalSize: number;
}

interface QueueItem {
  id: number;
  tidal_url: string;
  title: string;
  artist: string;
  status: string;
  source: string;
  quality: string;
  cover_url: string | null;
  created_at: string;
}

// Cover lookup cache — fetches from Last.fm public API (no auth needed)
const _coverCache = new Map<string, string | null>();
function useAlbumCover(artist: string, album: string): string | null {
  const key = `${artist}|||${album}`.toLowerCase();
  const [cover, setCover] = useState<string | null>(_coverCache.get(key) ?? null);

  useEffect(() => {
    if (_coverCache.has(key)) { setCover(_coverCache.get(key) ?? null); return; }
    if (!artist || !album) return;
    const apiKey = "ef3a8db881b15b6ef062eed7781a5a22"; // public Last.fm key
    fetch(`https://ws.audioscrobbler.com/2.0/?method=album.getinfo&api_key=${apiKey}&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&format=json`)
      .then((r) => r.json())
      .then((d) => {
        const images = d?.album?.image ?? [];
        const large = images.find((i: { size: string }) => i.size === "extralarge") ?? images[images.length - 1];
        const url = large?.["#text"] || null;
        _coverCache.set(key, url);
        setCover(url);
      })
      .catch(() => { _coverCache.set(key, null); });
  }, [key, artist, album]);

  return cover;
}

// ── Quality helpers ─────────────────────────────────────────────

/** Normalize Tidal quality tags to {label, tier} for display */
function normalizeQualityTags(tags: string[]): { label: string; tier: "hi-res" | "lossless" | "high" | "standard" }[] {
  if (!tags?.length) return [];
  const upper = tags.map((t) => t.toUpperCase());
  const result: { label: string; tier: "hi-res" | "lossless" | "high" | "standard" }[] = [];
  if (upper.includes("HIRES_LOSSLESS")) result.push({ label: "Hi-Res 24bit", tier: "hi-res" });
  else if (upper.includes("LOSSLESS")) result.push({ label: "FLAC 16/44.1", tier: "lossless" });
  else if (upper.includes("MQA")) result.push({ label: "MQA", tier: "lossless" });
  else if (upper.includes("HIGH")) result.push({ label: "AAC 320", tier: "high" });
  else result.push({ label: tags[0] ?? "Unknown", tier: "standard" });
  return result;
}

/** Tidal quality tags → numeric tier for comparison (higher = better) */
function qualityTier(tags: string[]): number {
  if (!tags?.length) return 0;
  const upper = tags.map((t) => t.toUpperCase());
  if (upper.includes("HIRES_LOSSLESS")) return 3; // 24-bit hi-res
  if (upper.includes("LOSSLESS")) return 2;        // 16/44.1 CD
  if (upper.includes("MQA")) return 2;
  if (upper.includes("HIGH")) return 1;             // lossy high
  return 0;
}

/** Local quality → numeric tier */
function localQualityTier(lq: { format?: string; bit_depth?: number; sample_rate?: number }): number {
  if (!lq?.format) return 0;
  const fmt = (lq.format || "").toLowerCase();
  if (fmt === "flac" || fmt === "alac" || fmt === "wav") {
    if ((lq.bit_depth || 0) > 16 || (lq.sample_rate || 0) > 48000) return 3; // hi-res
    return 2; // CD lossless
  }
  if (fmt === "mp3" || fmt === "aac" || fmt === "ogg" || fmt === "opus") return 1;
  return 0;
}


function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const STATUS_ICONS: Record<string, typeof Loader2> = {
  downloading: Loader2, queued: Clock, processing: Loader2,
  wishlist: Heart, completed: CheckCircle2, failed: XCircle,
};
const STATUS_COLORS: Record<string, string> = {
  downloading: "text-blue-500", queued: "text-yellow-500", processing: "text-blue-500",
  wishlist: "text-pink-500", completed: "text-green-500", failed: "text-red-500",
};

// Session persistence helpers — survive navigation, cleared on tab close
const STORE_KEY = "crate:acquisition:search";
function loadSession(): { query: string; results: SearchResult | null; soulseek: SoulseekResult[] | null; tab: "tidal" | "soulseek" } {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { query: "", results: null, soulseek: null, tab: "tidal" };
}
function saveSession(data: { query: string; results: SearchResult | null; soulseek: SoulseekResult[] | null; tab: "tidal" | "soulseek" }) {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

export function DownloadPage() {
  const [searchParams] = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";
  const session = loadSession();
  const [query, setQuery] = useState(initialQ || session.query);
  const [results, setResults] = useState<SearchResult | null>(session.results);
  const [searching, setSearching] = useState(false);
  const [quality, setQuality] = useState("max");
  const [activeDownloads, setActiveDownloads] = useState<Set<string>>(new Set());
  const [soulseekResults, setSoulseekResults] = useState<SoulseekResult[] | null>(session.soulseek);
  const [searchingSlsk, setSearchingSlsk] = useState(false);
  const [, setSlskSearchId] = useState<string | null>(null);
  const slskPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [resultTab, setResultTab] = useState<"tidal" | "soulseek">(session.tab);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadTaskId, setUploadTaskId] = useState<string | null>(null);
  const [browsingArtist, setBrowsingArtist] = useState<{ id: string; name: string; picture: string | null } | null>(null);
  const { data: tidalQueue, refetch: refetchTidalQueue } = useApi<QueueItem[]>("/api/tidal/queue");
  const { data: slskQueue, refetch: refetchSlskQueue } = useApi<{ source: string; artist: string; album: string; filename: string; fullPath?: string; status: string; progress: number; username: string; speed: number }[]>("/api/acquisition/queue");
  const { data: tidalStatus } = useApi<{ authenticated: boolean }>("/api/tidal/status");

  // Merged queue
  const queue = tidalQueue;
  const slskDownloads = slskQueue?.filter((d) => d.source === "soulseek") ?? [];
  function refetchQueue() { refetchTidalQueue(); refetchSlskQueue(); }

  // Persist search state across navigation
  useEffect(() => {
    saveSession({ query, results, soulseek: soulseekResults, tab: resultTab });
  }, [query, results, soulseekResults, resultTab]);

  // Auto-refresh queue
  useEffect(() => {
    const hasActive = queue?.some((q) => ["downloading", "queued", "processing"].includes(q.status));
    if (!hasActive) return;
    const timer = setInterval(refetchQueue, 5000);
    return () => clearInterval(timer);
  }, [queue, refetchQueue]);

  const doSearch = useCallback(async (q?: string) => {
    const term = (q ?? query).trim();
    if (term.length < 2) return;
    setSearching(true);
    try {
      const data = await api<SearchResult>(`/api/tidal/search?q=${encodeURIComponent(term)}&limit=20`);
      setResults(data);
    } catch {
      toast.error("Search failed — check Tidal authentication");
    } finally {
      setSearching(false);
    }
    // Also search Soulseek (non-blocking: start search, then poll)
    if (term.length >= 3) {
      // Clear previous poll
      if (slskPollRef.current) clearInterval(slskPollRef.current);
      setSoulseekResults(null);
      setSearchingSlsk(true);
      setSlskSearchId(null);

      api<{ search_id: string }>("/api/acquisition/search/soulseek", "POST", { query: term })
        .then((d) => {
          if (d.search_id) {
            setSlskSearchId(d.search_id);
            // Poll every 3s for progressive results
            const poll = setInterval(async () => {
              try {
                const r = await api<{ results: SoulseekResult[]; isComplete: boolean; responseCount: number }>(
                  `/api/acquisition/search/soulseek/${d.search_id}`
                );
                setSoulseekResults(r.results);
                if (r.isComplete) {
                  clearInterval(poll);
                  setSearchingSlsk(false);
                }
              } catch {
                clearInterval(poll);
                setSearchingSlsk(false);
              }
            }, 3000);
            slskPollRef.current = poll;
            // Auto-stop after 30s
            setTimeout(() => { clearInterval(poll); setSearchingSlsk(false); }, 30000);
          }
        })
        .catch(() => { setSoulseekResults([]); setSearchingSlsk(false); });

    }
  }, [query]);

  // Auto-search on mount if URL has ?q=
  useEffect(() => {
    if (initialQ) doSearch(initialQ);
    return () => { if (slskPollRef.current) clearInterval(slskPollRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function startDownload(url: string, title: string, source = "search", upgradeAlbumId?: number) {
    setActiveDownloads((prev) => new Set(prev).add(url));
    try {
      const body: Record<string, unknown> = { url, quality, source, title };
      if (upgradeAlbumId) body.upgrade_album_id = upgradeAlbumId;
      await api("/api/tidal/download", "POST", body);
      toast.success(upgradeAlbumId ? `Upgrade queued: ${title}` : `Queued: ${title}`);
      refetchQueue();
    } catch {
      toast.error("Failed to queue download");
    } finally {
      setActiveDownloads((prev) => { const s = new Set(prev); s.delete(url); return s; });
    }
  }

  async function addToWishlist(item: { url: string; tidal_id: string; title: string; artist: string; cover_url?: string | null; content_type?: string }) {
    try {
      await api("/api/tidal/wishlist", "POST", { ...item, quality });
      toast.success(`Wishlisted: ${item.title}`);
      refetchQueue();
    } catch {
      toast.error("Failed to add to wishlist");
    }
  }

  async function removeQueueItem(id: number) {
    await api(`/api/tidal/queue/${id}`, "DELETE").catch(() => {});
    refetchQueue();
  }

  async function promoteWishlist(id: number) {
    await api(`/api/tidal/queue/${id}`, "PUT", { status: "queued" }).catch(() => {});
    toast.success("Moved to download queue");
    refetchQueue();
  }

  async function downloadFromSoulseek(result: SoulseekResult) {
    try {
      await api("/api/acquisition/download", "POST", {
        source: "soulseek",
        username: result.username,
        artist: result.artist,
        album: result.album,
        files: result.files,
      });
      toast.success(`Downloading from Soulseek: ${result.artist} - ${result.album}`);
    } catch {
      toast.error("Failed to start download");
    }
  }

  async function submitUpload() {
    if (uploadFiles.length === 0) return;
    const formData = new FormData();
    for (const file of uploadFiles) {
      formData.append("files", file);
    }
    setUploading(true);
    try {
      const response = await api<{ task_id: string }>("/api/acquisition/upload", "POST", formData);
      setUploadTaskId(response.task_id);
      toast.success("Upload queued");
      setUploadFiles([]);
      refetchQueue();
    } catch {
      toast.error("Failed to queue upload");
    } finally {
      setUploading(false);
    }
  }

  const activeQueue = queue?.filter((q) => ["downloading", "queued", "processing"].includes(q.status)) ?? [];
  const wishlist = queue?.filter((q) => q.status === "wishlist") ?? [];
  const history = queue?.filter((q) => ["completed", "failed"].includes(q.status)) ?? [];

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-white/10 bg-panel-surface/95 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/12 text-primary shadow-[0_18px_40px_rgba(6,182,212,0.14)]">
                <Download size={22} />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Acquisition</h1>
                <p className="text-sm text-white/55">
                  Intake for Tidal, Soulseek and uploads into the shared Crate library.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <CrateChip className={tidalStatus?.authenticated ? "border-green-500/25 bg-green-500/10 text-green-300" : "border-red-500/25 bg-red-500/10 text-red-300"}>
                Tidal {tidalStatus?.authenticated ? "connected" : "disconnected"}
              </CrateChip>
              <CrateChip className={activeQueue.length > 0 ? "border-blue-500/25 bg-blue-500/10 text-blue-300" : ""}>
                {activeQueue.length} active
              </CrateChip>
              <CrateChip>{wishlist.length} wishlist</CrateChip>
              <CrateChip>{slskDownloads.length} Soulseek downloads</CrateChip>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-md border border-white/8 bg-white/[0.03] p-3 xl:min-w-[520px]">
            <div className="relative min-w-[240px] flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSearch()}
                placeholder="Search Tidal + Soulseek..."
                className="h-10 rounded-md border-white/10 bg-white/[0.04] pl-9"
              />
            </div>
            <Select value={quality} onValueChange={setQuality}>
              <SelectTrigger className="w-36 rounded-md border-white/10 bg-white/[0.04]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="max">Max (HiRes)</SelectItem>
                <SelectItem value="high">High (FLAC)</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => doSearch()} disabled={searching || query.trim().length < 2}>
              {searching ? <Loader2 size={14} className="animate-spin mr-1" /> : <Search size={14} className="mr-1" />}
              Search
            </Button>
          </div>
        </div>
      </section>

      {browsingArtist && (
        <TidalArtistBrowser
          artistId={browsingArtist.id}
          artistName={browsingArtist.name}
          artistPicture={browsingArtist.picture}
          quality={quality}
          onBack={() => setBrowsingArtist(null)}
          onDownload={(url, title, upgradeAlbumId) => startDownload(url, title, "search", upgradeAlbumId)}
          onWishlist={(item) => addToWishlist(item)}
          activeDownloads={activeDownloads}
        />
      )}

      <Tabs defaultValue="search" className={browsingArtist ? "hidden" : ""}>
        <TabsList>
          <TabsTrigger value="search">Search Results</TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="queue">Queue {(activeQueue.length + slskDownloads.length) > 0 && <Badge variant="secondary" className="ml-1 text-[10px] px-1">{activeQueue.length + slskDownloads.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="wishlist">Wishlist {wishlist.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px] px-1">{wishlist.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Search Results */}
        <TabsContent value="search">
          {/* Source sub-tabs */}
          <div className="mt-4 mb-4 flex flex-wrap gap-2 border-b border-white/8 pb-3">
            <CratePill active={resultTab === "tidal"} onClick={() => setResultTab("tidal")}>
              Tidal
              {results && <span className="ml-1 text-white/40">{(results.albums?.length || 0) + (results.tracks?.length || 0)}</span>}
            </CratePill>
            <CratePill active={resultTab === "soulseek"} onClick={() => setResultTab("soulseek")}>
              Soulseek
              {soulseekResults && <span className="ml-1 text-white/40">{soulseekResults.length}</span>}
              {searchingSlsk && <Loader2 size={12} className="ml-1 animate-spin" />}
            </CratePill>
          </div>

          {/* Tidal results */}
          {resultTab === "tidal" && results ? (
            <div className="space-y-8">
              {/* Artists */}
              {(results.artists ?? []).length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <Users size={14} /> Artists
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {results.artists!.map((artist) => (
                      <div key={artist.id}
                        className="bg-card border border-border rounded-md p-4 text-center cursor-pointer hover:border-primary/40 transition-colors"
                        onClick={() => setBrowsingArtist({ id: artist.id, name: artist.name, picture: artist.picture })}
                      >
                        <div className="w-full aspect-square rounded-md mb-3 overflow-hidden bg-secondary mx-auto">
                          {artist.picture ? (
                            <img src={artist.picture} alt={artist.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Users size={32} className="text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="font-semibold text-sm truncate mb-1">{artist.name}</div>
                        <div className="text-[10px] text-muted-foreground">Click to browse albums</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Albums */}
              {(results.albums ?? []).length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <Disc3 size={14} /> Albums
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {results.albums!.map((album) => (
                      <TidalAlbumCard
                        key={album.id}
                        album={album}
                        isDownloading={activeDownloads.has(album.url)}
                        onDownloadAlbum={() => startDownload(album.url, `${album.artist} - ${album.title}`)}
                        onDownloadTrack={(trackUrl, title) => startDownload(trackUrl, title)}
                        onWishlist={() => addToWishlist({ url: album.url, tidal_id: album.id, title: album.title, artist: album.artist, cover_url: album.cover })}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Tracks */}
              {(results.tracks ?? []).length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <Music size={14} /> Tracks
                  </h2>
                  <div className="space-y-1">
                    {results.tracks!.map((track) => (
                      <div key={track.id} className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-secondary/30 transition-colors group">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{track.title}</div>
                          <div className="text-xs text-muted-foreground truncate">{track.artist} — {track.album}</div>
                        </div>
                        <span className="text-xs text-muted-foreground">{fmtDuration(track.duration)}</span>
                        <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => addToWishlist({ url: track.url, tidal_id: track.id, title: track.title, artist: track.artist, content_type: "track" })}>
                          <Heart size={13} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startDownload(track.url, `${track.artist} - ${track.title}`)}>
                          <Download size={14} />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!results.albums?.length && !results.tracks?.length && !results.artists?.length && (
                <div className="text-center py-12 text-muted-foreground">No results found</div>
              )}
            </div>
          ) : resultTab === "tidal" ? (
            <div className="text-center py-12 text-muted-foreground">Search to find music on Tidal</div>
          ) : null}

          {/* Soulseek Results */}
          {resultTab === "soulseek" && (
            <div>
              {soulseekResults && soulseekResults.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {soulseekResults.map((r, i) => (
                    <SlskResultCard key={i} result={r} onDownload={() => downloadFromSoulseek(r)} />
                  ))}
                </div>
              ) : soulseekResults && soulseekResults.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4">No Soulseek results</div>
              ) : searchingSlsk ? (
                <div className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" /></div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">Search to find music on Soulseek</div>
              )}
            </div>
          )}

        </TabsContent>

        <TabsContent value="upload">
          <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-md border border-border bg-card p-5">
              <h2 className="text-base font-semibold mb-2">Upload music into the library</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Upload individual tracks or zipped albums. Crate will import them into the global library and run the same enrichment pipeline as any other source.
              </p>
              <label className="flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border bg-secondary/20 px-6 py-8 text-center hover:border-primary/40 transition-colors">
                <div className="w-12 h-12 rounded-md bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <Upload size={22} />
                </div>
                <div className="text-sm font-medium">Choose files or drop them here</div>
                <div className="text-xs text-muted-foreground mt-2">
                  FLAC, MP3, AAC, WAV, OGG, OPUS, ALAC, or ZIP
                </div>
                <input
                  type="file"
                  multiple
                  accept=".flac,.mp3,.m4a,.ogg,.opus,.wav,.aac,.alac,.zip,audio/*,.zip"
                  className="hidden"
                  onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
                />
              </label>
              {uploadFiles.length > 0 && (
                <div className="mt-4 rounded-md border border-border bg-secondary/10 p-4">
                  <div className="text-sm font-medium mb-2">{uploadFiles.length} file{uploadFiles.length === 1 ? "" : "s"} ready</div>
                  <div className="max-h-56 overflow-y-auto space-y-1">
                    {uploadFiles.map((file) => (
                      <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center gap-2 text-sm text-muted-foreground px-2 py-1.5 rounded-md hover:bg-secondary/30">
                        {file.name.toLowerCase().endsWith(".zip") ? <Disc3 size={14} className="text-primary" /> : <Music size={14} className="text-primary" />}
                        <span className="truncate flex-1">{file.name}</span>
                        <span className="text-[11px]">{Math.round(file.size / 1024 / 1024 * 10) / 10} MB</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-md border border-border bg-card p-5 space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Import behavior</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>Imports land in the shared library.</li>
                <li>Library sync and enrichment run in the background.</li>
                <li>The uploader gets the imported music added to their collection automatically.</li>
              </ul>
              <Button onClick={submitUpload} disabled={uploading || uploadFiles.length === 0} className="w-full">
                {uploading ? <Loader2 size={14} className="animate-spin mr-2" /> : <Upload size={14} className="mr-2" />}
                Import to library
              </Button>
              {uploadTaskId && (
                <div className="rounded-md border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
                  Upload queued as task <span className="font-mono">{uploadTaskId}</span>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Queue */}
        <TabsContent value="queue">
          <div className="mt-4 space-y-2">
            {(slskDownloads.length > 0 || activeQueue.length > 0) && (
              <div className="flex gap-2 mb-3">
                <Button size="sm" variant="outline" onClick={async () => {
                  await api("/api/acquisition/queue/clear-completed", "POST");
                  refetchSlskQueue();
                  toast.success("Cleared completed downloads");
                }}>Clear Completed</Button>
                <Button size="sm" variant="outline" onClick={async () => {
                  await api("/api/acquisition/queue/clear-errored", "POST");
                  refetchSlskQueue();
                  toast.success("Cleared errored downloads");
                }}>Clear Errored</Button>
                <Button size="sm" variant="destructive" onClick={async () => {
                  await api("/api/acquisition/queue/cleanup-incomplete", "POST");
                  toast.success("Cleanup task created");
                }}>Clean Incomplete Albums</Button>
              </div>
            )}
            {activeQueue.length === 0 && slskDownloads.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No active downloads</div>
            ) : (
              <>
                {activeQueue.map((item) => (
                  <QueueRow key={item.id} item={item} onRemove={removeQueueItem} />
                ))}
                {slskDownloads.map((d, i) => (
                  <div key={`slsk-${i}`} className="flex items-center gap-3 p-3 bg-card border border-border rounded-md">
                    <div className="w-10 h-10 rounded bg-secondary flex items-center justify-center flex-shrink-0">
                      <Music size={16} className="text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{d.filename || d.album}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <Badge className="bg-purple-500/10 text-purple-400 border-0 text-[10px] px-1 py-0">SLSK</Badge>
                        <span>from {d.username}</span>
                        {d.speed > 0 && <span>{Math.round(d.speed / 1024)} KB/s</span>}
                        <span>{d.status}</span>
                      </div>
                      {d.progress > 0 && d.progress < 100 && (
                        <div className="h-1 bg-secondary rounded-md mt-1 overflow-hidden">
                          <div className="h-full bg-purple-500 rounded-md transition-all" style={{ width: `${d.progress}%` }} />
                        </div>
                      )}
                    </div>
                    {d.progress >= 100 && <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />}
                    {(d.status.includes("Errored") || d.status.includes("Rejected") || d.status.includes("Aborted")) && (
                      <Button size="sm" variant="outline" className="flex-shrink-0 text-xs"
                        onClick={async () => {
                          // Parse artist from directory path (e.g. "music/D/Dredg - 2002 - El Cielo/track.flac")
                          const path = (d.fullPath || d.filename || "").replace(/\\/g, "/");
                          const parts = path.split("/");
                          const dirName = parts.length >= 2 ? parts[parts.length - 2] : "";
                          // Try to extract artist from parent dir
                          const artistGuess = parts.length >= 3 ? parts[parts.length - 3] : "";
                          const trackName = parts[parts.length - 1]?.replace(/\.[^.]+$/, "").replace(/^\d+[\s._-]*/, "") || d.filename;

                          try {
                            await api("/api/acquisition/download", "POST", {
                              source: "soulseek",
                              find_alternate: true,
                              artist: d.artist || artistGuess,
                              album: d.album || dirName,
                              files: [{ filename: d.fullPath || d.filename, size: 0 }],
                            });
                            toast.success(`Searching alternate peer for: ${trackName}`);
                            refetchQueue();
                          } catch { toast.error("Retry failed"); }
                        }}>
                        <RotateCcw size={12} className="mr-1" /> Find alternate
                      </Button>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </TabsContent>

        {/* Wishlist */}
        <TabsContent value="wishlist">
          <div className="mt-4 space-y-2">
            {wishlist.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">Wishlist is empty</div>
            ) : (
              <>
                <div className="flex justify-end mb-2">
                  <Button size="sm" onClick={() => wishlist.forEach((w) => promoteWishlist(w.id))}>
                    <Download size={14} className="mr-1" /> Download All
                  </Button>
                </div>
                {wishlist.map((item) => (
                  <QueueRow key={item.id} item={item} onRemove={removeQueueItem} onPromote={promoteWishlist} />
                ))}
              </>
            )}
          </div>
        </TabsContent>

        {/* History */}
        <TabsContent value="history">
          <div className="mt-4 space-y-2">
            {history.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No download history</div>
            ) : history.map((item) => (
              <QueueRow key={item.id} item={item} onRemove={removeQueueItem} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function QueueRow({ item, onRemove, onPromote }: {
  item: QueueItem; onRemove: (id: number) => void; onPromote?: (id: number) => void;
}) {
  const Icon = STATUS_ICONS[item.status] || Clock;
  const color = STATUS_COLORS[item.status] || "text-muted-foreground";
  const isSpinning = item.status === "downloading" || item.status === "processing";

  return (
    <div className="flex items-center gap-3 rounded-md border border-white/10 bg-panel-surface px-4 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
      <Icon size={16} className={`${color} ${isSpinning ? "animate-spin" : ""} flex-shrink-0`} />
      {item.cover_url && <img src={item.cover_url} alt="" className="h-11 w-11 flex-shrink-0 rounded-md object-cover shadow-[0_12px_26px_rgba(0,0,0,0.18)]" />}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{item.title}</div>
        <div className="text-xs text-muted-foreground truncate">
          {item.artist && `${item.artist} · `}{item.source} · {item.quality}
        </div>
      </div>
      <CrateChip className={item.status === "completed" ? "border-green-500/25 bg-green-500/10 text-green-300" : item.status === "failed" ? "border-red-500/25 bg-red-500/10 text-red-300" : item.status === "wishlist" ? "border-pink-500/25 bg-pink-500/10 text-pink-300" : ""}>
        {item.status}
      </CrateChip>
      {onPromote && item.status === "wishlist" && (
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onPromote(item.id)} title="Download now">
          <ArrowUp size={14} />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onRemove(item.id)}>
        <Trash2 size={12} />
      </Button>
    </div>
  );
}


// ── Tidal Artist Album Browser ─────────────────────────────────

interface TidalArtistAlbum {
  id: string;
  title: string;
  artist: string;
  year: string;
  tracks: number;
  cover: string | null;
  url: string;
  quality: string[];
  duration: number;
  release_date: string;
  type: string;
  status: "local" | "available";
  local_quality?: { format?: string; bit_depth?: number; sample_rate?: number };
  local_album_id?: number;
}

function TidalArtistBrowser({
  artistId,
  artistName,
  artistPicture,
  quality: _quality,
  onBack,
  onDownload,
  onWishlist,
  activeDownloads,
}: {
  artistId: string;
  artistName: string;
  artistPicture: string | null;
  quality: string;
  onBack: () => void;
  onDownload: (url: string, title: string, upgradeAlbumId?: number) => void;
  onWishlist: (item: { url: string; tidal_id: string; title: string; artist: string; cover_url?: string | null }) => void;
  activeDownloads: Set<string>;
}) {
  const { data, loading } = useApi<{ albums: TidalArtistAlbum[]; artist_name: string }>(
    `/api/tidal/artists/${artistId}/albums`,
  );

  const albums = data?.albums ?? [];
  const localCount = albums.filter((a) => a.status === "local").length;
  const availableCount = albums.filter((a) => a.status === "available").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={14} className="mr-1" /> Back
        </Button>
        {artistPicture && (
          <img src={artistPicture} alt={artistName} className="w-12 h-12 rounded-md object-cover" />
        )}
        <div>
          <h2 className="text-lg font-semibold">{artistName}</h2>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>{albums.length} albums on Tidal</span>
            {localCount > 0 && <span className="text-green-400">{localCount} in library</span>}
            {availableCount > 0 && <span className="text-primary">{availableCount} available</span>}
          </div>
        </div>
        {availableCount > 0 && (
          <Button size="sm" className="ml-auto" onClick={() => {
            albums.filter((a) => a.status === "available").forEach((a) => onDownload(a.url, `${a.artist} - ${a.title}`));
          }}>
            <Download size={12} className="mr-1" /> Download all missing ({availableCount})
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin text-primary" />
        </div>
      ) : albums.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">No albums found on Tidal</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {albums.map((album) => (
            <TidalAlbumCard
              key={album.id}
              album={album}
              status={album.status}
              localQuality={album.local_quality}
              isDownloading={activeDownloads.has(album.url)}
              onDownloadAlbum={() => onDownload(album.url, `${album.artist} - ${album.title}`, album.local_album_id)}
              onDownloadTrack={(trackUrl, title) => onDownload(trackUrl, title)}
              onWishlist={() => onWishlist({ url: album.url, tidal_id: album.id, title: album.title, artist: album.artist, cover_url: album.cover })}
            />
          ))}
        </div>
      )}
    </div>
  );
}


// ── Tidal Album Card (unified — used in search + artist browser) ──

interface TidalTrackItem { id: string; title: string; artist: string; track_number: number; duration: number; url: string; quality: string[] }

function TidalAlbumCard({ album, isDownloading, onDownloadAlbum, onDownloadTrack, onWishlist, status, localQuality }: {
  album: TidalAlbum;
  isDownloading: boolean;
  onDownloadAlbum: () => void;
  onDownloadTrack: (url: string, title: string) => void;
  onWishlist: () => void;
  status?: "local" | "available";
  localQuality?: { format?: string; bit_depth?: number; sample_rate?: number };
}) {
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<TidalTrackItem[] | null>(null);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const isLocal = status === "local";
  const tidalTier = qualityTier(album.quality);
  const localTier = localQuality ? localQualityTier(localQuality) : 0;
  const hasUpgrade = isLocal && tidalTier > localTier;
  const normalizedQuality = normalizeQualityTags(album.quality);

  async function openTracklist() {
    setOpen(true);
    if (!tracks) {
      setLoadingTracks(true);
      try {
        const data = await api<{ tracks: TidalTrackItem[] }>(`/api/tidal/albums/${album.id}/tracks`);
        setTracks(data.tracks);
      } catch { setTracks([]); }
      finally { setLoadingTracks(false); }
    }
  }

  return (
    <>
      <div className={`bg-card border rounded-md overflow-hidden group transition-colors ${
        isLocal && !hasUpgrade ? "border-green-500/20 opacity-50" : isLocal && hasUpgrade ? "border-amber-500/30" : "border-border hover:border-primary/40"
      }`}>
        <div className="w-full aspect-square bg-secondary relative">
          {album.cover ? (
            <img src={album.cover} alt={album.title} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center"><Disc3 size={32} className="text-muted-foreground" /></div>
          )}
          {isLocal && !hasUpgrade && (
            <div className="absolute top-2 right-2">
              <Badge className="bg-green-500/90 text-white text-[10px] px-1.5 py-0">
                <CheckCircle2 size={10} className="mr-0.5" /> In library
              </Badge>
            </div>
          )}
          {hasUpgrade && (
            <div className="absolute top-2 right-2">
              <Badge className="bg-amber-500/90 text-white text-[10px] px-1.5 py-0">
                <ArrowUp size={10} className="mr-0.5" /> Upgrade available
              </Badge>
            </div>
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
            <Button size="icon" className="h-9 w-9 rounded-full bg-white text-black shadow-lg" onClick={onDownloadAlbum} title={hasUpgrade ? "Download upgrade" : "Download album"}>
              {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            </Button>
            <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full text-white hover:text-primary bg-white/10" onClick={openTracklist} title="View tracks">
              <List size={16} />
            </Button>
            <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full text-white hover:text-pink-400 bg-white/10" onClick={onWishlist} title="Wishlist">
              <Heart size={16} />
            </Button>
          </div>
        </div>
        <div className="p-2.5">
          <div className="font-medium text-sm truncate">{album.title}</div>
          <div className="text-xs text-muted-foreground truncate">{album.artist}</div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {album.year && <span className="text-[10px] text-muted-foreground">{album.year}</span>}
            <span className="text-[10px] text-muted-foreground">{album.tracks} tracks</span>
            {(album as any).type && (album as any).type !== "ALBUM" && (
              <Badge variant="outline" className="text-[9px] px-1 py-0">{(album as any).type}</Badge>
            )}
            {normalizedQuality.map((q) => (
              <span key={q.label} className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[9px] font-medium leading-relaxed ${
                q.tier === "hi-res" ? "border-amber-400/50 text-amber-300 bg-amber-400/10" :
                q.tier === "lossless" ? "border-cyan-400/40 text-cyan-300 bg-cyan-400/8" :
                q.tier === "high" ? "border-primary/30 text-primary/70" :
                "border-white/15 text-muted-foreground"
              }`}>{q.label}</span>
            ))}
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              {album.cover && <img src={album.cover} alt="" className="w-12 h-12 rounded object-cover" />}
              <div>
                <DialogTitle>{album.title}</DialogTitle>
                <p className="text-sm text-muted-foreground">{album.artist} {album.year && `(${album.year})`}</p>
              </div>
            </div>
          </DialogHeader>
          <div className="mt-2">
            {loadingTracks ? (
              <div className="flex items-center justify-center py-8"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
            ) : !tracks?.length ? (
              <div className="text-sm text-muted-foreground py-4 text-center">No tracks found</div>
            ) : (
              <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
                {tracks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-secondary/50 group/track">
                    <span className="text-[11px] text-muted-foreground w-5 text-right font-mono">{t.track_number}</span>
                    <span className="text-sm flex-1 truncate">{t.title}</span>
                    <span className="text-[11px] text-muted-foreground">{fmtDuration(t.duration)}</span>
                    <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover/track:opacity-100 transition-opacity"
                      onClick={() => onDownloadTrack(t.url, `${t.artist} - ${t.title}`)} title="Download track">
                      <Download size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-4 pt-3 border-t border-border">
              <Button size="sm" onClick={() => { onDownloadAlbum(); setOpen(false); }} className="flex-1">
                {isDownloading ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Download size={13} className="mr-1.5" />}
                Download full album
              </Button>
              <Button size="sm" variant="outline" onClick={onWishlist}>
                <Heart size={13} className="mr-1.5" /> Wishlist
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


// ── Soulseek Result Card (with cover + tracklist modal) ────────

function SlskResultCard({ result: r, onDownload }: { result: SoulseekResult; onDownload: () => void }) {
  const cover = useAlbumCover(r.artist, r.album);
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="bg-card border border-border rounded-md overflow-hidden hover:border-primary/30 transition-colors group">
        <div className="flex gap-3 p-3">
          <div className="w-14 h-14 rounded bg-secondary flex-shrink-0 overflow-hidden relative">
            {cover ? (
              <img src={cover} alt={`${r.artist} - ${r.album}`} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center"><Disc3 size={20} className="text-muted-foreground" /></div>
            )}
            <button onClick={() => setOpen(true)} className="absolute inset-0 bg-black/0 hover:bg-black/50 transition-colors flex items-center justify-center opacity-0 hover:opacity-100" title="View files">
              <List size={14} className="text-white" />
            </button>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div>
              <div className="text-sm font-medium truncate">{r.album}</div>
              <div className="text-xs text-muted-foreground truncate">{r.artist}</div>
            </div>
            <div className="flex flex-wrap gap-1">
              <span className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-medium leading-relaxed ${
                r.quality.toLowerCase().includes("flac 24") ? "border-amber-400/50 text-amber-300 bg-amber-400/10" :
                r.quality.toLowerCase().includes("flac") ? "border-cyan-400/40 text-cyan-300 bg-cyan-400/8" :
                "border-white/15 text-muted-foreground"
              }`}>{r.quality}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{r.files.length} tracks</Badge>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{Math.round(r.totalSize / 1048576)} MB</Badge>
              {r.freeSlot && (
                <Badge className="bg-green-500/10 text-green-400 border-green-500/20 text-[10px] px-1.5 py-0">
                  <Zap size={8} className="mr-0.5" /> Free
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Users size={10} />
                <span className="font-mono">{r.username}</span>
                <span className="text-white/20">|</span>
                <Gauge size={10} />
                <span>{r.speed > 1048576 ? `${(r.speed / 1048576).toFixed(1)} MB/s` : `${Math.round(r.speed / 1024)} KB/s`}</span>
              </div>
              <Button size="sm" variant="ghost" className="h-7 opacity-0 group-hover:opacity-100 transition-opacity" onClick={onDownload}>
                <Download size={12} className="mr-1" /> Get
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              {cover ? (
                <img src={cover} alt="" className="w-12 h-12 rounded object-cover" />
              ) : (
                <div className="w-12 h-12 rounded bg-secondary flex items-center justify-center"><Disc3 size={20} className="text-muted-foreground" /></div>
              )}
              <div>
                <DialogTitle>{r.album}</DialogTitle>
                <p className="text-sm text-muted-foreground">{r.artist}</p>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                  <span className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-medium leading-relaxed ${
                    r.quality.toLowerCase().includes("flac 24") ? "border-amber-400/50 text-amber-300 bg-amber-400/10" :
                    r.quality.toLowerCase().includes("flac") ? "border-cyan-400/40 text-cyan-300 bg-cyan-400/8" :
                    "border-white/15 text-muted-foreground"
                  }`}>{r.quality}</span>
                  <span>{Math.round(r.totalSize / 1048576)} MB</span>
                  <span>from {r.username}</span>
                  <span>{r.speed > 1048576 ? `${(r.speed / 1048576).toFixed(1)} MB/s` : `${Math.round(r.speed / 1024)} KB/s`}</span>
                </div>
              </div>
            </div>
          </DialogHeader>
          <div className="mt-2 space-y-0.5 max-h-[400px] overflow-y-auto">
            {r.files.map((f, i) => {
              const name = f.filename.replace(/\\/g, "/").split("/").pop() ?? f.filename;
              return (
                <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-secondary/50">
                  <span className="text-[11px] text-muted-foreground w-5 text-right font-mono">{i + 1}</span>
                  <span className="text-sm flex-1 truncate">{name}</span>
                  <span className="text-[11px] text-muted-foreground">{f.length > 0 ? fmtDuration(f.length) : ""}</span>
                  <span className="text-[11px] text-muted-foreground">{Math.round(f.size / 1048576)} MB</span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 pt-3 border-t border-border">
            <Button size="sm" onClick={() => { onDownload(); setOpen(false); }} className="w-full">
              <Download size={13} className="mr-1.5" /> Download all {r.files.length} files from {r.username}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
