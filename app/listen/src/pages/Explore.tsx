import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Search, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  DecadeDetailView,
  ExploreLoadingState,
  ExplorePill,
  ExploreSectionHeader,
  ExploreSectionRail,
  GenreDetailView,
  PlaylistCategoryView,
  SearchResultsView,
} from "@/components/explore/ExploreViews";
import {
  loadSystemPlaylistTracks,
  type BrowseFilters,
  type SearchResults,
  type SystemPlaylist,
} from "@/components/explore/explore-model";
import { useApi } from "@/hooks/use-api";
import { ApiError, api } from "@/lib/api";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { usePlayerActions } from "@/contexts/PlayerContext";

export function Explore() {
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const [searchParams, setSearchParams] = useSearchParams();
  const genreSlug = searchParams.get("genre");
  const playlistCategory = searchParams.get("playlistCategory");

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);

  const { data: filters, loading: filtersLoading } = useApi<BrowseFilters>("/api/browse/filters");
  const { data: systemPlaylists, loading: playlistsLoading, refetch: refetchSystemPlaylists } = useApi<SystemPlaylist[]>("/api/curation/playlists");

  async function handlePlayPlaylist(playlistId: number, playlistName: string) {
    try {
      const playlist = await loadSystemPlaylistTracks(playlistId);
      if (playlist.tracks.length > 0) {
        playAll(playlist.tracks, 0, { ...playlist.source, name: playlistName });
      }
    } catch {
      toast.error("Failed to play playlist");
    }
  }

  async function handleToggleFollow(playlistId: number, isFollowed: boolean) {
    try {
      await api(`/api/curation/playlists/${playlistId}/follow`, isFollowed ? "DELETE" : "POST");
      toast.success(isFollowed ? "Removed from your library" : "Added to your library");
      refetchSystemPlaylists();
    } catch {
      toast.error("Failed to update playlist");
    }
  }

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

    const controller = new AbortController();
    setSearching(true);

    api<SearchResults>(`/api/search?q=${encodeURIComponent(debouncedQuery)}&limit=20`, "GET", undefined, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setSearchResults(data);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          setSearchResults({ artists: [], albums: [], tracks: [] });
          return;
        }
        setSearchResults({ artists: [], albums: [], tracks: [] });
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });

    return () => {
      controller.abort();
    };
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
  if (playlistCategory) {
    return <PlaylistCategoryView category={playlistCategory} onBack={() => setSearchParams({})} />;
  }

  const playlistCategories = Array.from(
    new Set((systemPlaylists || []).map((playlist) => playlist.category).filter(Boolean)),
  ) as string[];
  const featuredPlaylists = (systemPlaylists || []).slice(0, 8);

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
          <ExploreLoadingState />
        ) : searchResults ? (
          <SearchResultsView results={searchResults} />
        ) : null
      ) : (
        <div className="space-y-6">
          {playlistsLoading ? (
            <ExploreLoadingState />
          ) : featuredPlaylists.length > 0 ? (
            <div className="space-y-4">
              <ExploreSectionHeader
                title="From Crate"
                subtitle="Global playlists curated and generated for discovery."
              />
              <ExploreSectionRail>
                {featuredPlaylists.map((playlist) => (
                  <PlaylistCard
                    key={playlist.id}
                    name={playlist.name}
                    description={playlist.description}
                    tracks={playlist.artwork_tracks}
                    coverDataUrl={playlist.cover_data_url}
                    meta={[
                      playlist.category || null,
                      `${playlist.track_count} tracks`,
                      playlist.follower_count > 0 ? `${playlist.follower_count} followers` : null,
                    ].filter(Boolean).join(" · ")}
                    badge={playlist.is_smart ? "Smart" : "Curated"}
                    systemPlaylist
                    isFollowed={playlist.is_followed}
                    onPlay={() => handlePlayPlaylist(playlist.id, playlist.name)}
                    onToggleFollow={() => handleToggleFollow(playlist.id, playlist.is_followed)}
                    onClick={() => navigate(`/curation/playlist/${playlist.id}`)}
                  />
                ))}
              </ExploreSectionRail>
            </div>
          ) : null}

          {playlistCategories.length > 0 ? (
            <div className="space-y-3">
              <ExploreSectionHeader
                title="Playlist Categories"
                subtitle="Browse system playlists by editorial lane."
              />
              <div className="flex flex-wrap gap-2">
                {playlistCategories.map((category) => (
                  <ExplorePill
                    key={category}
                    label={category}
                    onClick={() => setSearchParams({ playlistCategory: category })}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {filtersLoading ? (
            <ExploreLoadingState />
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
                      <ExplorePill
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
                      <ExplorePill
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
