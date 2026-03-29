import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Search, Loader2 } from "lucide-react";
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
  artist: string;
  name: string;
  year: string;
  has_cover: boolean;
}

interface SearchTrack {
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

interface Genre {
  id: number;
  name: string;
  slug: string;
  artist_count: number;
  album_count: number;
}

function genreColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 35%)`;
}

function GenreGrid({ genres }: { genres: Genre[] }) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
      {genres.map((genre) => (
        <button
          key={genre.id}
          onClick={() => navigate(`/explore?genre=${genre.slug}`)}
          className="relative overflow-hidden rounded-xl p-4 text-left transition-transform hover:scale-[1.02] active:scale-[0.98] min-h-[90px] flex flex-col justify-end"
          style={{ backgroundColor: genreColor(genre.name) }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
          <div className="relative z-10">
            <div className="text-sm font-bold text-white leading-tight">{genre.name}</div>
            <div className="text-xs text-white/60 mt-0.5">
              {genre.artist_count} artist{genre.artist_count !== 1 ? "s" : ""}
            </div>
          </div>
        </button>
      ))}
    </div>
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
                subtitle={`${a.album_count} album${a.album_count !== 1 ? "s" : ""}`}
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
                key={`${a.artist}-${a.name}`}
                artist={a.artist}
                album={a.name}
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
                key={t.path || `${t.artist}-${t.title}-${i}`}
                track={t}
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

export function Explore() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);

  const { data: genres, loading: genresLoading } = useApi<Genre[]>("/api/genres");

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
        <div className="space-y-4">
          <h2 className="text-lg font-bold px-1">Browse by Genre</h2>
          {genresLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="text-primary animate-spin" />
            </div>
          ) : genres && genres.length > 0 ? (
            <GenreGrid genres={genres} />
          ) : (
            <p className="text-muted-foreground text-sm">No genres found.</p>
          )}
        </div>
      )}
    </div>
  );
}
