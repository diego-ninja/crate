import { useNavigate, useSearchParams } from "react-router";
import { Plus, Heart, Users, Disc, ListMusic, Loader2, Play, Sparkles } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { TrackRow } from "@/components/cards/TrackRow";
import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { encPath } from "@/lib/utils";

type Tab = "playlists" | "artists" | "albums" | "liked";

interface MeStats {
  followed_artists: number;
  saved_albums: number;
  liked_tracks: number;
  playlists: number;
}

interface Playlist {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  is_smart: boolean;
  total_duration: number;
  created_at: string;
}

interface CuratedPlaylist {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  follower_count: number;
  is_smart: boolean;
  category?: string | null;
}

interface FollowedArtist {
  artist_name: string;
  created_at: string;
  album_count: number;
  track_count: number;
  has_photo: boolean;
}

interface SavedAlbum {
  saved_at: string;
  id: number;
  artist: string;
  name: string;
  year: string;
  has_cover: boolean;
  track_count: number;
  total_duration: number;
}

const tabs: { key: Tab; label: string; icon: typeof ListMusic }[] = [
  { key: "playlists", label: "Playlists", icon: ListMusic },
  { key: "artists", label: "Artists", icon: Users },
  { key: "albums", label: "Albums", icon: Disc },
  { key: "liked", label: "Liked", icon: Heart },
];

function parseTab(value: string | null): Tab {
  if (value === "artists" || value === "albums" || value === "liked") return value;
  return "playlists";
}

function formatTotalDuration(seconds: number): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={24} className="text-primary animate-spin" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function StatBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 rounded-lg bg-white/5 px-3 py-2.5 text-center">
      <div className="text-lg font-bold text-foreground">{value ?? 0}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function PlaylistsTab() {
  const navigate = useNavigate();
  const { data: playlists, loading } = useApi<Playlist[]>("/api/playlists");
  const { data: followedCurated, loading: followedLoading } = useApi<CuratedPlaylist[]>("/api/curation/followed");
  const { openCreatePlaylist } = usePlaylistComposer();

  if (loading || followedLoading) return <Spinner />;

  return (
    <div className="space-y-3">
      <button
        onClick={() => openCreatePlaylist()}
        className="flex items-center gap-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors px-4 py-2.5 text-sm font-medium text-foreground w-full"
      >
        <Plus size={16} className="text-primary" />
        New Playlist
      </button>

      {followedCurated && followedCurated.length > 0 ? (
        <div className="space-y-1">
          <div className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-white/35">
            From Crate
          </div>
          {followedCurated.map((playlist) => (
            <button
              key={`curated-${playlist.id}`}
              onClick={() => navigate(`/curation/playlist/${playlist.id}`)}
              className="flex items-center gap-3 w-full rounded-lg px-3 py-3 hover:bg-white/5 transition-colors text-left"
            >
              <PlaylistArtwork
                name={playlist.name}
                coverDataUrl={playlist.cover_data_url}
                tracks={playlist.artwork_tracks}
                className="w-10 h-10 rounded-md flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{playlist.name}</span>
                  <span className="inline-flex items-center rounded-md border border-primary/30 text-primary text-[10px] px-1.5 py-0 font-medium">
                    <Sparkles size={10} className="mr-0.5" />
                    {playlist.is_smart ? "Smart" : "Curated"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {playlist.track_count} track{playlist.track_count !== 1 ? "s" : ""}
                  {playlist.category ? ` · ${playlist.category}` : ""}
                  {playlist.follower_count > 0 ? ` · ${playlist.follower_count} follower${playlist.follower_count !== 1 ? "s" : ""}` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {!playlists || playlists.length === 0 ? (
        !followedCurated || followedCurated.length === 0 ? (
          <EmptyState message="No playlists yet. Create one to get started." />
        ) : null
      ) : (
        <div className="space-y-1">
          <div className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-white/35">
            Your Playlists
          </div>
          {playlists.map((pl) => (
            <button
              key={pl.id}
              onClick={() => navigate(`/playlist/${pl.id}`)}
              className="flex items-center gap-3 w-full rounded-lg px-3 py-3 hover:bg-white/5 transition-colors text-left"
            >
              <PlaylistArtwork
                name={pl.name}
                coverDataUrl={pl.cover_data_url}
                tracks={pl.artwork_tracks}
                className="w-10 h-10 rounded-md flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{pl.name}</span>
                  {pl.is_smart && (
                    <span className="inline-flex items-center rounded-md border border-primary/30 text-primary text-[10px] px-1.5 py-0 font-medium">
                      <Sparkles size={10} className="mr-0.5" />
                      Smart
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {pl.track_count} track{pl.track_count !== 1 ? "s" : ""}
                  {pl.total_duration > 0 && ` · ${formatTotalDuration(pl.total_duration)}`}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ArtistsTab() {
  const { data: artists, loading } = useApi<FollowedArtist[]>("/api/me/follows");

  if (loading) return <Spinner />;
  if (!artists || artists.length === 0) {
    return <EmptyState message="You haven't followed any artists yet. Explore the library to find artists you love." />;
  }

  return (
    <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
      {artists.map((a) => (
        <ArtistCard
          key={a.artist_name}
          name={a.artist_name}
          subtitle={`${a.album_count} album${a.album_count !== 1 ? "s" : ""}`}
        />
      ))}
    </div>
  );
}

function AlbumsTab() {
  const { data: albums, loading } = useApi<SavedAlbum[]>("/api/me/albums");

  if (loading) return <Spinner />;
  if (!albums || albums.length === 0) {
    return <EmptyState message="No saved albums yet." />;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {albums.map((a) => (
        <AlbumCard
          key={a.id}
          artist={a.artist}
          album={a.name}
          albumId={a.id}
          year={a.year}
        />
      ))}
    </div>
  );
}

function LikedTab() {
  const { likedTracks: tracks, loading } = useLikedTracks();
  const { playAll } = usePlayerActions();

  if (loading) return <Spinner />;
  if (!tracks || tracks.length === 0) {
    return <EmptyState message="No liked tracks yet. Tap the heart on any track to save it here." />;
  }

  function handlePlayAll() {
    if (!tracks || tracks.length === 0) return;
    const playerTracks: Track[] = tracks.map((t) => ({
      id: t.relative_path || t.path,
      title: t.title,
      artist: t.artist,
      album: t.album,
      albumCover: t.artist && t.album
        ? `/api/cover/${encPath(t.artist)}/${encPath(t.album)}`
        : undefined,
      path: t.relative_path || t.path,
      navidromeId: t.navidrome_id,
      libraryTrackId: t.track_id,
    }));
    playAll(playerTracks, 0);
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handlePlayAll}
        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Play size={16} fill="currentColor" />
        Play All
      </button>
      <div>
        {tracks.map((t, i) => (
          <TrackRow
            key={t.track_id}
            track={{
              id: t.track_id,
              title: t.title,
              artist: t.artist,
              album: t.album,
              duration: t.duration,
              path: t.relative_path || t.path,
              navidrome_id: t.navidrome_id,
              library_track_id: t.track_id,
            }}
            index={i + 1}
            showArtist
            showAlbum
            albumCover={t.artist && t.album ? `/api/cover/${encPath(t.artist)}/${encPath(t.album)}` : undefined}
            showCoverThumb
          />
        ))}
      </div>
    </div>
  );
}

export function Library() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: stats } = useApi<MeStats>("/api/me");
  const tab = parseTab(searchParams.get("tab"));

  function setTab(tab: Tab) {
    setSearchParams({ tab });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Your Library</h1>
      </div>

      {/* Stats */}
      {stats && (
        <div className="flex gap-2">
          <StatBox value={stats.followed_artists} label="Artists" />
          <StatBox value={stats.saved_albums} label="Albums" />
          <StatBox value={stats.liked_tracks} label="Tracks" />
          <StatBox value={stats.playlists} label="Playlists" />
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-2">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "bg-primary text-primary-foreground"
                : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "playlists" && <PlaylistsTab />}
      {tab === "artists" && <ArtistsTab />}
      {tab === "albums" && <AlbumsTab />}
      {tab === "liked" && <LikedTab />}
    </div>
  );
}
