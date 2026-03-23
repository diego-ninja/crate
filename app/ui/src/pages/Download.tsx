import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Search, Download, Disc3, Music, Users, Loader2,
  CheckCircle2, ExternalLink,
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

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function DownloadPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [quality, setQuality] = useState("max");
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());

  const doSearch = useCallback(async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const data = await api<SearchResult>(`/api/tidal/search?q=${encodeURIComponent(query)}&limit=20`);
      setResults(data);
    } catch (e) {
      toast.error("Search failed");
    } finally {
      setSearching(false);
    }
  }, [query]);

  async function startDownload(url: string, label: string) {
    setDownloading((prev) => new Set(prev).add(url));
    try {
      const { task_id } = await api<{ task_id: string }>("/api/tidal/download", "POST", { url, quality });
      toast.success(`Downloading: ${label}`);
      // Poll for completion
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string }>(`/api/tasks/${task_id}`);
          if (task.status === "completed") {
            clearInterval(poll);
            setDownloading((prev) => { const s = new Set(prev); s.delete(url); return s; });
            setDownloaded((prev) => new Set(prev).add(url));
            toast.success(`Downloaded: ${label}`);
          } else if (task.status === "failed") {
            clearInterval(poll);
            setDownloading((prev) => { const s = new Set(prev); s.delete(url); return s; });
            toast.error(`Download failed: ${label}`);
          }
        } catch { /* polling */ }
      }, 3000);
      setTimeout(() => clearInterval(poll), 3600000);
    } catch {
      setDownloading((prev) => { const s = new Set(prev); s.delete(url); return s; });
      toast.error("Failed to start download");
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Download size={24} className="text-primary" />
        <h1 className="text-2xl font-bold">Download from Tidal</h1>
      </div>

      {/* Search bar */}
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
            <SelectItem value="normal">Normal (AAC)</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={doSearch} disabled={searching || query.trim().length < 2}>
          {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          <span className="ml-1">Search</span>
        </Button>
      </div>

      {/* Results */}
      {results && (
        <div className="space-y-6">
          {/* Albums */}
          {(results.albums ?? []).length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                <Disc3 size={14} /> Albums ({results.albums!.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {results.albums!.map((album) => (
                  <Card key={album.id} className="flex items-center gap-4 p-3 bg-card">
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
                        {album.quality.map((q) => (
                          <Badge key={q} variant="outline" className="text-[9px] px-1 py-0">{q}</Badge>
                        ))}
                      </div>
                    </div>
                    <DownloadButton
                      url={album.url}
                      label={`${album.artist} - ${album.title}`}
                      isDownloading={downloading.has(album.url)}
                      isDownloaded={downloaded.has(album.url)}
                      onDownload={startDownload}
                    />
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Tracks */}
          {(results.tracks ?? []).length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                <Music size={14} /> Tracks ({results.tracks!.length})
              </h2>
              <div className="space-y-1">
                {results.tracks!.map((track) => (
                  <div key={track.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-secondary/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{track.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{track.artist} — {track.album}</div>
                    </div>
                    <span className="text-xs text-muted-foreground">{fmtDuration(track.duration)}</span>
                    <DownloadButton
                      url={track.url}
                      label={`${track.artist} - ${track.title}`}
                      isDownloading={downloading.has(track.url)}
                      isDownloaded={downloaded.has(track.url)}
                      onDownload={startDownload}
                      small
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Artists */}
          {(results.artists ?? []).length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                <Users size={14} /> Artists ({results.artists!.length})
              </h2>
              <div className="flex flex-wrap gap-3">
                {results.artists!.map((artist) => (
                  <a
                    key={artist.id}
                    href={`https://tidal.com/artist/${artist.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border hover:border-primary transition-colors"
                  >
                    {artist.picture ? (
                      <img src={artist.picture} alt="" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                        <Users size={16} className="text-muted-foreground" />
                      </div>
                    )}
                    <span className="text-sm font-medium">{artist.name}</span>
                    <ExternalLink size={12} className="text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* No results */}
          {!results.albums?.length && !results.tracks?.length && !results.artists?.length && (
            <div className="text-center py-12 text-muted-foreground">
              No results found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DownloadButton({
  url, label, isDownloading, isDownloaded, onDownload, small,
}: {
  url: string; label: string; isDownloading: boolean; isDownloaded: boolean;
  onDownload: (url: string, label: string) => void; small?: boolean;
}) {
  if (isDownloaded) {
    return <CheckCircle2 size={small ? 16 : 18} className="text-green-500 flex-shrink-0" />;
  }
  return (
    <Button
      variant="ghost"
      size={small ? "icon" : "sm"}
      className={small ? "h-7 w-7" : ""}
      disabled={isDownloading}
      onClick={() => onDownload(url, label)}
    >
      {isDownloading ? (
        <Loader2 size={small ? 14 : 14} className="animate-spin" />
      ) : (
        <Download size={small ? 14 : 14} />
      )}
    </Button>
  );
}
