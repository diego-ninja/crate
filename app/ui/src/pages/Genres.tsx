import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { Input } from "@/components/ui/input";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { useApi } from "@/hooks/use-api";
import { Search } from "lucide-react";

interface AnalyticsData {
  genres: Record<string, number>;
  computing?: boolean;
}

const GENRE_COLORS = [
  "from-violet-600/40 to-violet-900/20",
  "from-blue-600/40 to-blue-900/20",
  "from-cyan-600/40 to-cyan-900/20",
  "from-emerald-600/40 to-emerald-900/20",
  "from-green-600/40 to-green-900/20",
  "from-yellow-600/40 to-yellow-900/20",
  "from-orange-600/40 to-orange-900/20",
  "from-red-600/40 to-red-900/20",
  "from-pink-600/40 to-pink-900/20",
  "from-fuchsia-600/40 to-fuchsia-900/20",
  "from-rose-600/40 to-rose-900/20",
  "from-indigo-600/40 to-indigo-900/20",
  "from-teal-600/40 to-teal-900/20",
  "from-amber-600/40 to-amber-900/20",
  "from-lime-600/40 to-lime-900/20",
  "from-sky-600/40 to-sky-900/20",
];

function genreColor(genre: string): string {
  let hash = 0;
  for (let i = 0; i < genre.length; i++) {
    hash = genre.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GENRE_COLORS[Math.abs(hash) % GENRE_COLORS.length]!;
}

export function Genres() {
  const { data, loading } = useApi<AnalyticsData>("/api/analytics");
  const [filter, setFilter] = useState("");
  const navigate = useNavigate();

  const genres = useMemo(() => {
    if (!data?.genres) return [];
    const entries = Object.entries(data.genres)
      .filter(([name]) => name.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => b[1] - a[1]);
    return entries;
  }, [data?.genres, filter]);

  const maxCount = genres.length > 0 ? genres[0]![1] : 1;

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Genres</h1>
        <GridSkeleton count={12} columns="grid-cols-4" />
      </div>
    );
  }

  if (data?.computing) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Genres</h1>
        <div className="text-muted-foreground text-sm">
          Analytics are being computed. This page will update automatically.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Genres</h1>

      <div className="relative mb-6 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter genres..."
          className="pl-9 bg-card border-border"
        />
      </div>

      {genres.length === 0 ? (
        <div className="text-sm text-muted-foreground">No genres found.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {genres.map(([name, count]) => {
            const weight = count / maxCount;
            const isTop = weight > 0.5;
            return (
              <button
                key={name}
                onClick={() => navigate(`/browse?q=${encodeURIComponent(name)}`)}
                className={`text-left rounded-lg border border-border p-4 bg-gradient-to-br ${genreColor(name)} transition-all duration-200 hover:scale-[1.03] hover:shadow-lg hover:shadow-primary/10 ${isTop ? "col-span-1 row-span-1" : ""}`}
              >
                <div className="font-semibold text-foreground text-sm truncate">{name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {count} track{count !== 1 ? "s" : ""}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
