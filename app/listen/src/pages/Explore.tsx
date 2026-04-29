import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowRight, Radio, Route } from "lucide-react";
import { toast } from "sonner";

import {
  DecadeDetailView,
  ExploreLoadingState,
  ExplorePill,
  ExploreSectionHeader,
  ExploreSectionRail,
  GenreDetailView,
  PlaylistCategoryView,
} from "@/components/explore/ExploreViews";
import {
  loadSystemPlaylistTracks,
  type BrowseFilters,
  type SystemPlaylist,
} from "@/components/explore/explore-model";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { usePlayerActions } from "@/contexts/PlayerContext";

export function Explore() {
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const [searchParams, setSearchParams] = useSearchParams();
  const genreSlug = searchParams.get("genre");
  const playlistCategory = searchParams.get("playlistCategory");

  const { data: explorePage, loading, refetch } = useApi<ExplorePageData>("/api/browse/explore-page");
  const filters = explorePage?.filters;
  const featuredPlaylists = explorePage?.playlists || [];
  const moods = explorePage?.moods || [];

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
      refetch();
    } catch {
      toast.error("Failed to update playlist");
    }
  }

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
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Explore</h1>
      <div className="space-y-6">
        {loading ? (
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
                  playlistId={playlist.id}
                  name={playlist.name}
                  isSmart={playlist.is_smart}
                  description={playlist.description}
                  tracks={playlist.artwork_tracks}
                  coverDataUrl={playlist.cover_data_url}
                  meta={[
                    playlist.category || null,
                    `${playlist.track_count} tracks`,
                    playlist.follower_count > 0 ? `${playlist.follower_count} followers` : null,
                  ].filter(Boolean).join(" · ")}
                  systemPlaylist
                  crateManaged
                  isFollowed={playlist.is_followed}
                  href={`/curation/playlist/${playlist.id}`}
                  onPlay={() => handlePlayPlaylist(playlist.id, playlist.name)}
                  onToggleFollow={() => handleToggleFollow(playlist.id, playlist.is_followed)}
                  onClick={() => navigate(`/curation/playlist/${playlist.id}`)}
                />
              ))}
            </ExploreSectionRail>
          </div>
        ) : null}

        {filters ? (
          <>
            {/* Radio + Paths */}
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => navigate("/radio")}
                className="group flex items-center gap-4 rounded-xl border border-primary/15 bg-primary/5 p-4 text-left transition hover:border-primary/30 hover:bg-primary/10"
              >
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                  <Radio size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">Radio</div>
                  <div className="mt-0.5 text-[12px] text-white/50">
                    Infinite music shaped by your likes and dislikes
                  </div>
                </div>
                <ArrowRight size={16} className="flex-shrink-0 text-primary/40 transition group-hover:translate-x-0.5 group-hover:text-primary" />
              </button>
              <button
                onClick={() => navigate("/paths")}
                className="group flex items-center gap-4 rounded-xl border border-primary/15 bg-primary/5 p-4 text-left transition hover:border-primary/30 hover:bg-primary/10"
              >
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                  <Route size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">Music Paths</div>
                  <div className="mt-0.5 text-[12px] text-white/50">
                    Trace a route between artists, genres, or tracks
                  </div>
                </div>
                <ArrowRight size={16} className="flex-shrink-0 text-primary/40 transition group-hover:translate-x-0.5 group-hover:text-primary" />
              </button>
            </div>

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
            {/* Moods — browse by audio analysis */}
            <MoodBrowseSection moods={moods} />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">No filters available.</p>
        )}
      </div>
    </div>
  );
}

const MOOD_COLORS: Record<string, string> = {
  energetic: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  chill: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  dark: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  happy: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  melancholy: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  intense: "bg-red-500/20 text-red-300 border-red-500/30",
  groovy: "bg-green-500/20 text-green-300 border-green-500/30",
  acoustic: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

interface MoodPreset { name: string; track_count: number; }

interface ExplorePageData {
  filters: BrowseFilters;
  playlists: SystemPlaylist[];
  moods: MoodPreset[];
}

function MoodBrowseSection({ moods }: { moods: MoodPreset[] }) {
  const { playAll } = usePlayerActions();
  const [loadingMood, setLoadingMood] = useState<string | null>(null);

  async function playMood(mood: string) {
    // Resume AudioContext synchronously in the user gesture before the await
    try {
      const w = window as unknown as Record<string, AudioContext>;
      if (!w.__crateAudioCtx) w.__crateAudioCtx = new AudioContext();
      if (w.__crateAudioCtx.state === "suspended") w.__crateAudioCtx.resume();
    } catch { /* ok */ }
    setLoadingMood(mood);
    try {
      const data = await api<{ tracks: Array<{
        id: number;
        entity_uid?: string;
        title: string;
        artist: string;
        artist_id?: number;
        artist_entity_uid?: string;
        artist_slug?: string;
        album: string;
        album_id?: number;
        album_entity_uid?: string;
        album_slug?: string;
        path: string;
      }> }>(`/api/browse/mood/${mood}?limit=50`);
      if (data.tracks.length > 0) {
        playAll(
          data.tracks.map((t) =>
            toPlayableTrack(t, {
              cover: albumCoverApiUrl({
                albumId: t.album_id,
                albumEntityUid: t.album_entity_uid,
                artistEntityUid: t.artist_entity_uid,
                albumSlug: t.album_slug,
                artistName: t.artist,
                albumName: t.album,
              }),
            }),
          ),
          0,
          { type: "playlist", name: `${mood.charAt(0).toUpperCase() + mood.slice(1)} Mix` },
        );
      } else {
        toast.info("No tracks match this mood yet — analyze more of your library");
      }
    } catch {
      toast.error("Failed to load mood tracks");
    } finally {
      setLoadingMood(null);
    }
  }

  if (moods.length === 0) return null;

  return (
    <div className="space-y-3">
      <ExploreSectionHeader title="Browse by Mood" subtitle="Powered by audio analysis of your library." />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {moods.map((m) => (
          <button
            key={m.name}
            onClick={() => playMood(m.name)}
            disabled={loadingMood !== null}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${MOOD_COLORS[m.name] || "bg-white/5 text-white/70 border-white/10"} active:scale-[0.98]`}
          >
            <span className="text-sm font-medium capitalize">{loadingMood === m.name ? "Loading..." : m.name}</span>
            <span className="block text-[10px] opacity-60 mt-0.5">{m.track_count} tracks</span>
          </button>
        ))}
      </div>
    </div>
  );
}
