import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
// Card unused for now but may be used later
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { encPath, formatNumber } from "@/lib/utils";
import { Search, Sparkles, Tag, Disc3, Users, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/error-state";

interface Genre {
  id: number;
  name: string;
  slug: string;
  artist_count: number;
  album_count: number;
}

interface GenreDetail extends Genre {
  artists: {
    artist_name: string;
    weight: number;
    source: string;
    album_count: number;
    track_count: number;
    has_photo: number;
    spotify_popularity: number | null;
    listeners: number | null;
  }[];
  albums: {
    album_id: number;
    weight: number;
    artist: string;
    name: string;
    year: string | null;
    track_count: number;
    has_cover: number;
  }[];
}

const GENRE_COLORS = [
  "from-primary/30 to-primary/10",
  "from-blue-600/30 to-blue-900/10",
  "from-emerald-600/30 to-emerald-900/10",
  "from-green-600/30 to-green-900/10",
  "from-yellow-600/30 to-yellow-900/10",
  "from-orange-600/30 to-orange-900/10",
  "from-red-600/30 to-red-900/10",
  "from-pink-600/30 to-pink-900/10",
  "from-fuchsia-600/30 to-fuchsia-900/10",
  "from-indigo-600/30 to-indigo-900/10",
  "from-teal-600/30 to-teal-900/10",
  "from-amber-600/30 to-amber-900/10",
  "from-sky-600/30 to-sky-900/10",
  "from-violet-600/30 to-violet-900/10",
  "from-rose-600/30 to-rose-900/10",
  "from-lime-600/30 to-lime-900/10",
];

function genreColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return GENRE_COLORS[Math.abs(hash) % GENRE_COLORS.length]!;
}

// ── Genre List ──────────────────────────────────────────────────

export function Genres() {
  const { slug } = useParams<{ slug?: string }>();

  if (slug) return <GenreView slug={slug} />;
  return <GenreList />;
}

function GenreList() {
  const { data: genres, loading, error, refetch } = useApi<Genre[]>("/api/genres");
  const [filter, setFilter] = useState("");
  const [indexing, setIndexing] = useState(false);
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    if (!genres) return [];
    return genres
      .filter((g) => g.name.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => b.artist_count - a.artist_count);
  }, [genres, filter]);

  async function reindex() {
    setIndexing(true);
    try {
      const { task_id } = await api<{ task_id: string }>("/api/genres/index", "POST");
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string }>(`/api/tasks/${task_id}`);
          if (task.status === "completed") {
            clearInterval(poll);
            setIndexing(false);
            toast.success("Genres re-indexed");
            window.location.reload();
          } else if (task.status === "failed") {
            clearInterval(poll);
            setIndexing(false);
            toast.error("Genre indexing failed");
          }
        } catch { /* polling */ }
      }, 2000);
    } catch { setIndexing(false); toast.error("Failed to start indexing"); }
  }

  if (error) return <ErrorState message="Failed to load genres" onRetry={refetch} />;
  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Genres</h1>
        <GridSkeleton count={12} columns="grid-cols-4" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Tag size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">Genres</h1>
          {genres && <span className="text-sm text-muted-foreground">({genres.length})</span>}
        </div>
        <Button variant="outline" size="sm" onClick={reindex} disabled={indexing}>
          {indexing ? <Loader2 size={14} className="animate-spin mr-1" /> : <Tag size={14} className="mr-1" />}
          Re-index
        </Button>
      </div>

      <div className="relative mb-6 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter genres..."
          className="pl-9 bg-card border-border"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {genres?.length === 0 ? (
            <div className="space-y-3">
              <p>No genres indexed yet.</p>
              <Button onClick={reindex} disabled={indexing}>Index Genres</Button>
            </div>
          ) : "No genres match your filter."}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((g) => (
            <button
              key={g.id}
              onClick={() => navigate(`/genres/${g.slug}`)}
              className={`text-left rounded-lg border border-border p-4 bg-gradient-to-br ${genreColor(g.name)} transition-all duration-200 hover:scale-[1.03] hover:shadow-lg hover:shadow-primary/10`}
            >
              <div className="font-semibold text-foreground text-sm truncate">{g.name}</div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1.5">
                <span className="flex items-center gap-1"><Users size={11} />{g.artist_count}</span>
                <span className="flex items-center gap-1"><Disc3 size={11} />{g.album_count}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Genre Detail View ───────────────────────────────────────────

function GenreView({ slug }: { slug: string }) {
  const { data: genre, loading } = useApi<GenreDetail>(`/api/genres/${slug}`);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  async function createSmartPlaylist() {
    if (!genre) return;
    setCreating(true);
    try {
      const { id } = await api<{ id: number }>("/api/playlists", "POST", {
        name: `${genre.name} Mix`,
        is_smart: true,
        smart_rules: {
          match: "all",
          rules: [{ field: "genre", op: "contains", value: genre.name }],
          limit: 50,
          sort: "random",
        },
      });
      await api(`/api/playlists/${id}/generate`, "POST");
      toast.success(`Created "${genre.name} Mix" playlist`);
      navigate("/playlists");
    } catch { toast.error("Failed to create playlist"); } finally { setCreating(false); }
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate("/genres")}>
            <ArrowLeft size={14} className="mr-1" /> Genres
          </Button>
        </div>
        <GridSkeleton count={6} columns="grid-cols-3" />
      </div>
    );
  }

  if (!genre) {
    return (
      <div className="text-center py-12 text-muted-foreground">Genre not found</div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/genres")}>
          <ArrowLeft size={14} className="mr-1" /> Genres
        </Button>
      </div>
      <div className={`rounded-xl p-6 mb-6 bg-gradient-to-br ${genreColor(genre.name)} border border-border`}>
        <h1 className="text-3xl font-black mb-2">{genre.name}</h1>
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
          <span className="flex items-center gap-1"><Users size={14} />{genre.artists.length} artists</span>
          <span className="flex items-center gap-1"><Disc3 size={14} />{genre.albums.length} albums</span>
        </div>
        <Button size="sm" onClick={createSmartPlaylist} disabled={creating}>
          {creating ? <Loader2 size={14} className="animate-spin mr-1" /> : <Sparkles size={14} className="mr-1" />}
          Generate Playlist
        </Button>
      </div>

      {/* Top Artists */}
      {genre.artists.length > 0 && (
        <div className="mb-8">
          <h2 className="font-semibold mb-4">Top Artists</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {genre.artists.map((a) => (
              <button
                key={a.artist_name}
                onClick={() => navigate(`/artist/${encPath(a.artist_name)}`)}
                className="bg-card border border-border rounded-lg p-3 text-left hover:border-primary transition-colors"
              >
                <div className="w-full aspect-square rounded-lg mb-2 overflow-hidden bg-secondary">
                  <img
                    src={`/api/artist/${encPath(a.artist_name)}/photo`}
                    alt={a.artist_name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
                <div className="font-semibold text-sm truncate">{a.artist_name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {a.album_count} albums
                  {a.listeners ? ` · ${formatNumber(a.listeners)} listeners` : ""}
                </div>
                {a.weight >= 0.8 && (
                  <Badge variant="outline" className="text-[10px] mt-1 px-1 py-0">primary</Badge>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Albums */}
      {genre.albums.length > 0 && (
        <div>
          <h2 className="font-semibold mb-4">Albums</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {genre.albums.map((a) => (
              <button
                key={a.album_id}
                onClick={() => navigate(`/album/${encPath(a.artist)}/${encPath(a.name)}`)}
                className="bg-card border border-border rounded-lg overflow-hidden text-left hover:border-primary transition-colors"
              >
                <div className="w-full aspect-square bg-secondary">
                  <img
                    src={`/api/cover/${encPath(a.artist)}/${encPath(a.name)}`}
                    alt={a.name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
                <div className="p-2.5">
                  <div className="font-medium text-sm truncate">{a.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{a.artist}</div>
                  {a.year && <div className="text-[10px] text-muted-foreground">{a.year}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
