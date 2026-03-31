import { useState, useEffect } from "react";
import { useSearchParams } from "react-router";
import { Search, Loader2, ArrowLeft } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { TrackRow } from "@/components/cards/TrackRow";

interface SearchArtist {
  name: string;
  album_count: number;
  has_photo: boolean;
}

interface SearchAlbum {
  id: number;
  artist: string;
  name: string;
  year: string;
  has_cover: boolean;
}

interface SearchTrack {
  id: number;
  title: string;
  artist: string;
  album: string;
  path: string;
  duration: number;
  navidrome_id: string;
}

interface SearchResults {
  artists: SearchArtist[];
  albums: SearchAlbum[];
  tracks: SearchTrack[];
}

interface BrowseFilters {
  genres: { name: string; count: number }[];
  decades: string[];
}

function Pill({ label, count, onClick }: { label: string; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 hover:border-primary/40 hover:bg-primary/5 transition-colors"
    >
      <span className="text-sm font-medium text-primary">{label}</span>
      {count != null && count > 0 && <span className="text-xs text-white/50">{count}</span>}
    </button>
  );
}

function SearchResultsView({ results }: { results: SearchResults }) {
  const hasArtists = results.artists.length > 0;
  const hasAlbums = results.albums.length > 0;
  const hasTracks = results.tracks.length > 0;

  if (!hasArtists && !hasAlbums && !hasTracks) {
    return <p className="text-muted-foreground text-sm mt-8">No results found.</p>;
  }

  return (
    <div className="space-y-8">
      {hasArtists && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold px-1">Artists</h2>
          <div className="flex gap-4 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {results.artists.map((a) => (
              <ArtistCard
                key={a.name}
                name={a.name}
                subtitle={a.album_count ? `${a.album_count} albums` : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {hasAlbums && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold px-1">Albums</h2>
          <div className="flex gap-4 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {results.albums.map((a) => (
              <AlbumCard
                key={a.id || `${a.artist}-${a.name}`}
                artist={a.artist}
                album={a.name}
                albumId={a.id}
                year={a.year}
              />
            ))}
          </div>
        </div>
      )}

      {hasTracks && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold px-1">Tracks</h2>
          <div className="rounded-xl bg-white/[0.02] border border-white/5">
            {results.tracks.slice(0, 10).map((t, i) => (
              <TrackRow
                key={`${t.artist}-${t.title}-${i}`}
                track={{
                  ...t,
                  path: t.path || "",
                  duration: t.duration || 0,
                  library_track_id: t.id,
                }}
                index={i + 1}
                showArtist
                showAlbum
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Genre Detail View ────────────────────────────────────────────

interface GenreDetail {
  id: number;
  name: string;
  slug: string;
  artists: { artist_name: string; album_count: number; track_count: number; has_photo: boolean; listeners: number | null }[];
  albums: { album_id: number; artist: string; name: string; year: string; track_count: number; has_cover: boolean }[];
}

function GenreDetailView({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { data, loading } = useApi<GenreDetail>(`/api/genres/${slug}`);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="text-primary animate-spin" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-muted-foreground text-sm">Genre not found.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-white/5 text-white/50 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{data.name}</h1>
          <p className="text-sm text-muted-foreground">{data.artists.length} artists, {data.albums.length} albums</p>
        </div>
      </div>

      {data.artists.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold px-1">Artists</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            {data.artists.map((a) => (
              <ArtistCard key={a.artist_name} name={a.artist_name} subtitle={`${a.album_count} albums`} compact />
            ))}
          </div>
        </div>
      )}

      {data.albums.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold px-1">Albums</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {data.albums.map((a) => (
              <AlbumCard key={a.album_id || `${a.artist}-${a.name}`} artist={a.artist} album={a.name} albumId={a.album_id} year={a.year} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Decade Detail View ───────────────────────────────────────────

interface DecadeArtists {
  items: { name: string; albums: number; tracks: number; has_photo: boolean }[];
  total: number;
}

function DecadeDetailView({ decade, onBack }: { decade: string; onBack: () => void }) {
  const { data, loading } = useApi<DecadeArtists>(`/api/artists?decade=${decade}&limit=50`);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-white/5 text-white/50 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{decade}</h1>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} artists</p>
        </div>
      </div>

      {data && data.items.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          {data.items.map((a) => (
            <ArtistCard key={a.name} name={a.name} subtitle={`${a.albums} albums`} compact />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No artists found for this decade.</p>
      )}
    </div>
  );
}

export function Explore() {
  const [searchParams, setSearchParams] = useSearchParams();
  const genreSlug = searchParams.get("genre");

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);

  const { data: filters, loading: filtersLoading } = useApi<BrowseFilters>("/api/browse/filters");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);

    api<SearchResults>(`/api/search?q=${encodeURIComponent(debouncedQuery)}&limit=20`)
      .then((data) => {
        if (!cancelled) setSearchResults(data);
      })
      .catch(() => {
        if (!cancelled) setSearchResults({ artists: [], albums: [], tracks: [] });
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });

    return () => { cancelled = true; };
  }, [debouncedQuery]);

  const isSearching = debouncedQuery.trim().length > 0;

  // Genre or decade detail view
  const decadeParam = searchParams.get("decade");
  if (genreSlug) {
    return <GenreDetailView slug={genreSlug} onBack={() => setSearchParams({})} />;
  }
  if (decadeParam) {
    return <DecadeDetailView decade={decadeParam} onBack={() => setSearchParams({})} />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Explore</h1>

      {/* Search input */}
      <div className="relative">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artists, albums, tracks..."
          className="w-full h-11 pl-10 pr-4 rounded-xl bg-white/5 border border-white/10 text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors"
        />
        {searching && (
          <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* Search results or genre browser */}
      {isSearching ? (
        searching && !searchResults ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="text-primary animate-spin" />
          </div>
        ) : searchResults ? (
          <SearchResultsView results={searchResults} />
        ) : null
      ) : (
        <div className="space-y-6">
          {filtersLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="text-primary animate-spin" />
            </div>
          ) : filters ? (
            <>
              {/* Genres — top 10 by artist count */}
              <div className="space-y-3">
                <h2 className="text-lg font-bold px-1">Genres</h2>
                <div className="flex flex-wrap gap-2">
                  {filters.genres
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 10)
                    .map((g) => (
                      <Pill
                        key={g.name}
                        label={g.name}
                        count={g.count}
                        onClick={() => setSearchParams({ genre: g.name.toLowerCase().replace(/\s+/g, "-") })}
                      />
                    ))}
                </div>
              </div>

              {/* Decades */}
              {filters.decades.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-lg font-bold px-1">Decades</h2>
                  <div className="flex flex-wrap gap-2">
                    {filters.decades.map((d) => (
                      <Pill
                        key={d}
                        label={d}
                        count={0}
                        onClick={() => setSearchParams({ decade: d })}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">No filters available.</p>
          )}
        </div>
      )}
    </div>
  );
}
