import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
  CheckCircle2, ExternalLink, Heart, Clock, XCircle,
  Trash2, ArrowUp,
} from "lucide-react";

interface TidalAlbum {
  id: string;
  title: string;
  artist: string;
  year: string;
  tracks: number;
  cover: string | null;
  url: string;
  quality: string[];
  status?: string;
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
  downloading: Loader2,
  queued: Clock,
  processing: Loader2,
  wishlist: Heart,
  completed: CheckCircle2,
  failed: XCircle,
};

const STATUS_COLORS: Record<string, string> = {
  downloading: "text-blue-500",
  queued: "text-yellow-500",
  processing: "text-blue-500",
  wishlist: "text-pink-500",
  completed: "text-green-500",
  failed: "text-red-500",
};

export function DownloadPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [quality, setQuality] = useState("max");
  const [activeDownloads, setActiveDownloads] = useState<Set<string>>(new Set());
  const { data: queue, refetch: refetchQueue } = useApi<QueueItem[]>("/api/tidal/queue");
  const { data: tidalStatus } = useApi<{ authenticated: boolean }>("/api/tidal/status");

  // Auto-refresh queue
  useEffect(() => {
    const hasActive = queue?.some((q) => ["downloading", "queued", "processing"].includes(q.status));
    if (!hasActive) return;
    const timer = setInterval(refetchQueue, 5000);
    return () => clearInterval(timer);
  }, [queue, refetchQueue]);

  const doSearch = useCallback(async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const data = await api<SearchResult>(`/api/tidal/search?q=${encodeURIComponent(query)}&limit=20`);
      setResults(data);
    } catch {
      toast.error("Search failed — check Tidal authentication");
    } finally {
      setSearching(false);
    }
  }, [query]);

  async function startDownload(url: string, title: string, source = "search") {
    setActiveDownloads((prev) => new Set(prev).add(url));
    try {
      await api("/api/tidal/download", "POST", { url, quality, source });
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
      await api("/api/tidal/wishlist", "POST", {
        url: item.url,
        tidal_id: item.tidal_id,
        title: item.title,
        artist: item.artist,
        cover_url: item.cover_url,
        content_type: item.content_type || "album",
        quality,
      });
      toast.success(`Added to wishlist: ${item.title}`);
      refetchQueue();
    } catch {
      toast.error("Failed to add to wishlist");
    }
  }

  async function removeQueueItem(id: number) {
    try {
      await api(`/api/tidal/queue/${id}`, "DELETE");
      refetchQueue();
    } catch { toast.error("Failed to remove"); }
  }

  async function promoteWishlist(id: number) {
    try {
      await api(`/api/tidal/queue/${id}`, "PUT", { status: "queued" });
      toast.success("Moved to download queue");
      refetchQueue();
    } catch { toast.error("Failed to queue"); }
  }

  const activeQueue = queue?.filter((q) => ["downloading", "queued", "processing"].includes(q.status)) ?? [];
  const wishlist = queue?.filter((q) => q.status === "wishlist") ?? [];
  const history = queue?.filter((q) => ["completed", "failed"].includes(q.status)) ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Download size={24} className="text-primary" />
        <h1 className="text-2xl font-bold">Tidal</h1>
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
            placeholder="Search Tidal..."
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
        <Button onClick={doSearch} disabled={searching || query.trim().length < 2}>
          {searching ? <Loader2 size={14} className="animate-spin mr-1" /> : <Search size={14} className="mr-1" />}
          Search
        </Button>
      </div>

      <Tabs defaultValue="search">
        <TabsList>
          <TabsTrigger value="search">Search Results</TabsTrigger>
          <TabsTrigger value="queue">
            Queue {activeQueue.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px] px-1">{activeQueue.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="wishlist">
            Wishlist {wishlist.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px] px-1">{wishlist.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Search Results */}
        <TabsContent value="search">
          {results ? (
            <div className="space-y-6 mt-4">
              {(results.albums ?? []).length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <Disc3 size={14} /> Albums
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {results.albums!.map((album) => (
                      <AlbumCard key={album.id} album={album}
                        onDownload={startDownload} onWishlist={addToWishlist}
                        isDownloading={activeDownloads.has(album.url)} />
                    ))}
                  </div>
                </div>
              )}
              {(results.tracks ?? []).length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <Music size={14} /> Tracks
                  </h2>
                  <div className="space-y-1">
                    {results.tracks!.map((track) => (
                      <div key={track.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-secondary/30">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{track.title}</div>
                          <div className="text-xs text-muted-foreground truncate">{track.artist} — {track.album}</div>
                        </div>
                        <span className="text-xs text-muted-foreground">{fmtDuration(track.duration)}</span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startDownload(track.url, `${track.artist} - ${track.title}`)}>
                          <Download size={14} />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(results.artists ?? []).length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <Users size={14} /> Artists
                  </h2>
                  <div className="flex flex-wrap gap-3">
                    {results.artists!.map((artist) => (
                      <a key={artist.id} href={`https://tidal.com/artist/${artist.id}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border hover:border-primary">
                        {artist.picture ? <img src={artist.picture} alt="" className="w-10 h-10 rounded-full object-cover" /> : <div className="w-10 h-10 rounded-full bg-secondary" />}
                        <span className="text-sm font-medium">{artist.name}</span>
                        <ExternalLink size={12} className="text-muted-foreground" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {!results.albums?.length && !results.tracks?.length && !results.artists?.length && (
                <div className="text-center py-12 text-muted-foreground">No results found</div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground mt-4">Search Tidal to find music</div>
          )}
        </TabsContent>

        {/* Queue */}
        <TabsContent value="queue">
          <div className="mt-4 space-y-2">
            {activeQueue.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No active downloads</div>
            ) : activeQueue.map((item) => (
              <QueueRow key={item.id} item={item} onRemove={removeQueueItem} />
            ))}
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

function AlbumCard({ album, onDownload, onWishlist, isDownloading }: {
  album: TidalAlbum;
  onDownload: (url: string, title: string) => void;
  onWishlist: (item: { url: string; tidal_id: string; title: string; artist: string; cover_url?: string | null }) => void;
  isDownloading: boolean;
}) {
  return (
    <Card className="flex items-center gap-4 p-3 bg-card">
      {album.cover ? (
        <img src={album.cover} alt="" className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
      ) : (
        <div className="w-16 h-16 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
          <Disc3 size={24} className="text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">{album.title}</div>
        <div className="text-xs text-muted-foreground truncate">{album.artist} · {album.year}</div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground">{album.tracks} tracks</span>
          {album.quality.map((q) => <Badge key={q} variant="outline" className="text-[9px] px-1 py-0">{q}</Badge>)}
          {album.status === "local" && <Badge className="text-[9px] px-1 py-0 bg-green-500/20 text-green-500">In Library</Badge>}
        </div>
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Add to wishlist"
          onClick={() => onWishlist({ url: album.url, tidal_id: album.id, title: album.title, artist: album.artist, cover_url: album.cover })}>
          <Heart size={14} />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={isDownloading || album.status === "local"}
          onClick={() => onDownload(album.url, `${album.artist} - ${album.title}`)}>
          {isDownloading ? <Loader2 size={14} className="animate-spin" /> : album.status === "local" ? <CheckCircle2 size={14} className="text-green-500" /> : <Download size={14} />}
        </Button>
      </div>
    </Card>
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
