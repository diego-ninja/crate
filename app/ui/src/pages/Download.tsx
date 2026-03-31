import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { toast } from "sonner";
import {
  Search, Download, Disc3, Music, Users, Loader2,
  CheckCircle2, Heart, Clock, XCircle,
  Trash2, ArrowUp, RotateCcw, Upload,
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

export function DownloadPage() {
  const [searchParams] = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initialQ);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [quality, setQuality] = useState("max");
  const [activeDownloads, setActiveDownloads] = useState<Set<string>>(new Set());
  const [soulseekResults, setSoulseekResults] = useState<SoulseekResult[] | null>(null);
  const [searchingSlsk, setSearchingSlsk] = useState(false);
  const [, setSlskSearchId] = useState<string | null>(null);
  const slskPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [resultTab, setResultTab] = useState<"tidal" | "soulseek">("tidal");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadTaskId, setUploadTaskId] = useState<string | null>(null);
  const { data: tidalQueue, refetch: refetchTidalQueue } = useApi<QueueItem[]>("/api/tidal/queue");
  const { data: slskQueue, refetch: refetchSlskQueue } = useApi<{ source: string; artist: string; album: string; filename: string; fullPath?: string; status: string; progress: number; username: string; speed: number }[]>("/api/acquisition/queue");
  const { data: tidalStatus } = useApi<{ authenticated: boolean }>("/api/tidal/status");

  // Merged queue
  const queue = tidalQueue;
  const slskDownloads = slskQueue?.filter((d) => d.source === "soulseek") ?? [];
  function refetchQueue() { refetchTidalQueue(); refetchSlskQueue(); }

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

  async function startDownload(url: string, title: string, source = "search") {
    setActiveDownloads((prev) => new Set(prev).add(url));
    try {
      await api("/api/tidal/download", "POST", { url, quality, source, title });
      toast.success(`Queued: ${title}`);
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
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Download size={24} className="text-primary" />
        <h1 className="text-2xl font-bold">Acquisition</h1>
        {tidalStatus && (
          <div className={`w-2 h-2 rounded-full ${tidalStatus.authenticated ? "bg-green-500" : "bg-red-500"}`} title={tidalStatus.authenticated ? "Connected" : "Not authenticated"} />
        )}
        {activeQueue.length > 0 && (
          <Badge variant="outline" className="text-blue-500 border-blue-500/30">
            {activeQueue.length} in queue
          </Badge>
        )}
      </div>

      {/* Search */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1 max-w-lg">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Search Tidal + Soulseek..."
            className="pl-9"
          />
        </div>
        <Select value={quality} onValueChange={setQuality}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
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

      <Tabs defaultValue="search">
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
          <div className="flex gap-2 mt-4 mb-4 border-b border-border pb-2">
            <button
              className={`px-3 py-1.5 text-sm rounded-t-lg transition-colors ${resultTab === "tidal" ? "text-primary border-b-2 border-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setResultTab("tidal")}
            >
              Tidal {results && <Badge variant="secondary" className="ml-1 text-[10px] px-1">{(results.albums?.length || 0) + (results.tracks?.length || 0)}</Badge>}
            </button>
            <button
              className={`px-3 py-1.5 text-sm rounded-t-lg transition-colors ${resultTab === "soulseek" ? "text-primary border-b-2 border-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setResultTab("soulseek")}
            >
              Soulseek {soulseekResults && <Badge variant="secondary" className="ml-1 text-[10px] px-1">{soulseekResults.length}</Badge>}
              {searchingSlsk && <Loader2 size={12} className="animate-spin ml-1 inline" />}
            </button>
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
                      <div key={artist.id} className="bg-card border border-border rounded-lg p-4 text-center">
                        <div className="w-full aspect-square rounded-lg mb-3 overflow-hidden bg-secondary mx-auto">
                          {artist.picture ? (
                            <img src={artist.picture} alt={artist.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Users size={32} className="text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="font-semibold text-sm truncate mb-2">{artist.name}</div>
                        <div className="flex gap-1.5 justify-center">
                          <Button size="sm" variant="outline" onClick={() => { setQuery(artist.name); doSearch(artist.name); }}>
                            <Search size={12} className="mr-1" /> Albums
                          </Button>
                          <Button size="sm" onClick={() => startDownload(`https://tidal.com/artist/${artist.id}`, artist.name, "discography")}>
                            <Download size={12} className="mr-1" /> All
                          </Button>
                        </div>
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
                      <div key={album.id} className="bg-card border border-border rounded-lg overflow-hidden hover:border-primary transition-colors group">
                        <div className="w-full aspect-square bg-secondary relative">
                          {album.cover ? (
                            <img src={album.cover} alt={album.title} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Disc3 size={32} className="text-muted-foreground" />
                            </div>
                          )}
                          {/* Hover overlay with actions */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                            <Button size="icon" className="h-9 w-9 rounded-full bg-foreground text-background" onClick={() => startDownload(album.url, `${album.artist} - ${album.title}`)}>
                              {activeDownloads.has(album.url) ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                            </Button>
                            <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full text-white hover:text-pink-400" onClick={() => addToWishlist({ url: album.url, tidal_id: album.id, title: album.title, artist: album.artist, cover_url: album.cover })}>
                              <Heart size={16} />
                            </Button>
                          </div>
                        </div>
                        <div className="p-2.5">
                          <div className="font-medium text-sm truncate">{album.title}</div>
                          <div className="text-xs text-muted-foreground truncate">{album.artist}</div>
                          <div className="flex items-center gap-2 mt-1">
                            {album.year && <span className="text-[10px] text-muted-foreground">{album.year}</span>}
                            <span className="text-[10px] text-muted-foreground">{album.tracks} tracks</span>
                            {album.quality.map((q) => <Badge key={q} variant="outline" className="text-[9px] px-1 py-0">{q}</Badge>)}
                          </div>
                        </div>
                      </div>
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
                      <div key={track.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-secondary/30 transition-colors group">
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
                <div className="space-y-2">
                  {soulseekResults.map((r, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-card border border-border rounded-lg">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{r.artist} — {r.album}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                          <Badge variant="outline" className="text-[10px] px-1 py-0">{r.quality}</Badge>
                          <span>{r.files.length} files</span>
                          <span>{Math.round(r.totalSize / 1048576)} MB</span>
                          <span>from {r.username}</span>
                          <span>{Math.round(r.speed / 1024)} KB/s</span>
                          {r.freeSlot && <Badge className="bg-green-500/10 text-green-500 text-[10px] px-1 py-0">Free slot</Badge>}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => downloadFromSoulseek(r)}>
                        <Download size={13} className="mr-1" /> Download
                      </Button>
                    </div>
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
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-base font-semibold mb-2">Upload music into the library</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Upload individual tracks or zipped albums. Crate will import them into the global library and run the same enrichment pipeline as any other source.
              </p>
              <label className="flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/20 px-6 py-8 text-center hover:border-primary/40 transition-colors">
                <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
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
                <div className="mt-4 rounded-xl border border-border bg-secondary/10 p-4">
                  <div className="text-sm font-medium mb-2">{uploadFiles.length} file{uploadFiles.length === 1 ? "" : "s"} ready</div>
                  <div className="max-h-56 overflow-y-auto space-y-1">
                    {uploadFiles.map((file) => (
                      <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center gap-2 text-sm text-muted-foreground px-2 py-1.5 rounded-lg hover:bg-secondary/30">
                        {file.name.toLowerCase().endsWith(".zip") ? <Disc3 size={14} className="text-primary" /> : <Music size={14} className="text-primary" />}
                        <span className="truncate flex-1">{file.name}</span>
                        <span className="text-[11px]">{Math.round(file.size / 1024 / 1024 * 10) / 10} MB</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
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
                <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
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
                  <div key={`slsk-${i}`} className="flex items-center gap-3 p-3 bg-card border border-border rounded-lg">
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
                        <div className="h-1 bg-secondary rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${d.progress}%` }} />
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
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border">
      <Icon size={16} className={`${color} ${isSpinning ? "animate-spin" : ""} flex-shrink-0`} />
      {item.cover_url && <img src={item.cover_url} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{item.title}</div>
        <div className="text-xs text-muted-foreground truncate">
          {item.artist && `${item.artist} · `}{item.source} · {item.quality}
        </div>
      </div>
      <Badge variant="outline" className={`text-[10px] ${color}`}>{item.status}</Badge>
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
