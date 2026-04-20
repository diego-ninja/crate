import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlbumRow } from "@/components/album/AlbumRow";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import {
  Loader2,
  Search,
  Disc3,
  Library,
  AlertTriangle,
  Download,
  CheckCircle2,
  Music,
} from "lucide-react";

interface MissingData {
  local_count: number;
  mb_count: number;
  missing_count: number;
  mb_artist_name?: string;
  missing: { title: string; first_release_date?: string; type: string }[];
  local: { name: string; track_count: number; mbid?: string; format?: string; size_mb?: number }[];
  error?: string;
}

interface ArtistSuggestion {
  name: string;
}

export function MissingAlbums() {
  const [artist, setArtist] = useState("");
  const [data, setData] = useState<MissingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<ArtistSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autocomplete
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = artist.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await api<{ items: ArtistSuggestion[] }>(`/api/artists?q=${encPath(q)}&per_page=8`);
        if (results.items) setSuggestions(results.items.slice(0, 8));
      } catch {
        setSuggestions([]);
      }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [artist]);

  function selectSuggestion(name: string) {
    setArtist(name);
    setShowSuggestions(false);
    setSuggestions([]);
    checkArtist(name);
  }

  async function checkArtist(name?: string) {
    const q = (name ?? artist).trim();
    if (!q) return;
    setLoading(true);
    setShowSuggestions(false);
    try {
      const result = await api<MissingData>(`/api/missing-search?q=${encPath(q)}`);
      setData(result);
    } finally {
      setLoading(false);
    }
  }

  function typeBadgeClass(type: string): string {
    const t = type.toLowerCase();
    if (t === "album") return "border-primary/30 text-primary";
    if (t === "ep") return "border-blue-500/30 text-blue-400";
    if (t === "single") return "border-emerald-500/30 text-emerald-400";
    if (t === "compilation") return "border-orange-500/30 text-orange-400";
    return "";
  }

  const completionPct = data && !data.error && data.mb_count > 0
    ? Math.round((data.local_count / data.mb_count) * 100)
    : null;

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Missing Albums</h2>
      <p className="text-muted-foreground text-sm mb-6">
        Compare your local collection with MusicBrainz discography.
      </p>

      {/* Search bar with autocomplete */}
      <div className="relative mb-8 max-w-xl">
        <div className="flex gap-3 items-end">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={artist}
              onChange={(e) => { setArtist(e.target.value); setShowSuggestions(true); }}
              onKeyDown={(e) => { if (e.key === "Enter") checkArtist(); }}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder="Search artist..."
              className="bg-input border-border pl-9"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-20 top-full mt-1 w-full bg-card border border-border rounded-md shadow-xl overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    key={s.name}
                    onMouseDown={() => selectSuggestion(s.name)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition-colors flex items-center gap-2"
                  >
                    <Music size={14} className="text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button onClick={() => checkArtist()} disabled={loading}>
            {loading ? (
              <><Loader2 size={14} className="animate-spin mr-1" /> Checking...</>
            ) : (
              "Check"
            )}
          </Button>
        </div>
      </div>

      {data?.error && (
        <div className="text-center py-12 text-muted-foreground">
          {data.error}
        </div>
      )}

      {loading && !data && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-md" />)}
          </div>
          <Skeleton className="h-6 w-48" />
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14 rounded-md" />)}
          </div>
        </div>
      )}

      {data && !data.error && (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Card className="bg-card border-border">
              <CardContent className="pt-5 pb-4 px-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                  <Library size={18} className="text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{data.local_count}</div>
                  <div className="text-xs text-muted-foreground">Local</div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="pt-5 pb-4 px-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-blue-500/10 flex items-center justify-center">
                  <Disc3 size={18} className="text-blue-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{data.mb_count}</div>
                  <div className="text-xs text-muted-foreground">MusicBrainz</div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="pt-5 pb-4 px-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-yellow-500/10 flex items-center justify-center">
                  <AlertTriangle size={18} className="text-yellow-400" />
                </div>
                <div>
                  <div className={`text-2xl font-bold ${data.missing_count > 0 ? "text-yellow-500" : "text-green-500"}`}>
                    {data.missing_count}
                  </div>
                  <div className="text-xs text-muted-foreground">Missing</div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="pt-5 pb-4 px-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle2 size={18} className="text-emerald-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{completionPct ?? 0}%</div>
                  <div className="text-xs text-muted-foreground">Complete</div>
                </div>
              </CardContent>
            </Card>
          </div>

          {data.mb_artist_name && (
            <p className="text-muted-foreground text-sm mb-6">
              Matched MB artist: <strong className="text-white/70">{data.mb_artist_name}</strong>
            </p>
          )}

          {/* Missing albums */}
          {data.missing.length > 0 ? (
            <div className="mb-10">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle size={16} className="text-yellow-500" />
                Missing from your library
                <span className="text-xs text-muted-foreground font-normal ml-1">{data.missing.length}</span>
              </h3>
              <div className="bg-card border border-border rounded-md divide-y divide-border">
                {data.missing.map((m) => (
                  <div key={m.title} className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors">
                    {/* Placeholder cover */}
                    <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-gradient-to-br from-yellow-600/20 to-yellow-900/10 flex items-center justify-center">
                      <Music size={18} className="text-yellow-500/50" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white/90 truncate">{m.title}</div>
                      <div className="text-xs text-white/40">{m.first_release_date || "Unknown year"}</div>
                    </div>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${typeBadgeClass(m.type)}`}>
                      {m.type}
                    </Badge>
                    <a
                      href={`https://search.lespedants.org?query=${encodeURIComponent(`${data.mb_artist_name || artist.trim()} ${m.title}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-white/30 hover:text-primary">
                        <Download size={14} />
                      </Button>
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-10 mb-8">
              <CheckCircle2 size={36} className="text-green-500 mx-auto mb-2" />
              <div className="text-green-500 font-medium">You have the complete discography!</div>
            </div>
          )}

          {/* Local albums */}
          {data.local.length > 0 && (
            <div>
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Library size={16} className="text-primary" />
                Your local albums
                <span className="text-xs text-muted-foreground font-normal ml-1">{data.local.length}</span>
              </h3>
              <div className="bg-card border border-border rounded-md divide-y divide-border">
                {data.local.map((l) => (
                  <AlbumRow
                    key={l.name}
                    artist={artist.trim()}
                    album={l.name}
                    tracks={l.track_count}
                    format={l.format}
                    size_mb={l.size_mb}
                    showArtist={false}
                    actions={
                      <span className="text-xs text-muted-foreground font-mono">
                        {l.mbid ? `${l.mbid.slice(0, 8)}...` : (
                          <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30 text-[10px] px-1.5 py-0">
                            No MBID
                          </Badge>
                        )}
                      </span>
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
