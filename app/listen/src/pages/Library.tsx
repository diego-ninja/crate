import { useState } from "react";
import { useNavigate } from "react-router";
import { Plus, Heart, Users, Disc, ListMusic, Loader2, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { TrackRow } from "@/components/cards/TrackRow";
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
  track_count: number;
  is_smart: boolean;
  total_duration: number;
  created_at: string;
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

interface LikedTrack {
  track_path: string;
  liked_at: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  navidrome_id?: string;
}

const tabs: { key: Tab; label: string; icon: typeof ListMusic }[] = [
  { key: "playlists", label: "Playlists", icon: ListMusic },
  { key: "artists", label: "Artists", icon: Users },
  { key: "albums", label: "Albums", icon: Disc },
  { key: "liked", label: "Liked", icon: Heart },
];

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
  const { data: playlists, loading, refetch } = useApi<Playlist[]>("/api/playlists");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setSubmitting(true);
    try {
      await api("/api/playlists", "POST", { name });
      toast.success("Playlist created");
      setNewName("");
      setCreating(false);
      refetch();
    } catch {
      toast.error("Failed to create playlist");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {/* New playlist button / inline form */}
      {creating ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            type="text"
            placeholder="Playlist name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
          <button
            onClick={handleCreate}
            disabled={submitting || !newName.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Create
          </button>
          <button
            onClick={() => { setCreating(false); setNewName(""); }}
            className="rounded-lg bg-white/5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors px-4 py-2.5 text-sm font-medium text-foreground w-full"
        >
          <Plus size={16} className="text-primary" />
          New Playlist
        </button>
      )}

      {/* Playlist list */}
      {!playlists || playlists.length === 0 ? (
        <EmptyState message="No playlists yet. Create one to get started." />
      ) : (
        <div className="space-y-1">
          {playlists.map((pl) => (
            <button
              key={pl.id}
              onClick={() => navigate(`/playlist/${pl.id}`)}
              className="flex items-center gap-3 w-full rounded-lg px-3 py-3 hover:bg-white/5 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-md bg-white/5 flex items-center justify-center flex-shrink-0">
                <ListMusic size={18} className="text-muted-foreground" />
              </div>
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
          key={`${a.artist}-${a.name}`}
          artist={a.artist}
          album={a.name}
          year={a.year}
        />
      ))}
    </div>
  );
}

function LikedTab() {
  const { data: tracks, loading } = useApi<LikedTrack[]>("/api/me/likes?limit=100");
  const { playAll } = usePlayerActions();

  if (loading) return <Spinner />;
  if (!tracks || tracks.length === 0) {
    return <EmptyState message="No liked tracks yet. Tap the heart on any track to save it here." />;
  }

  function handlePlayAll() {
    if (!tracks || tracks.length === 0) return;
    const playerTracks: Track[] = tracks.map((t) => ({
      id: t.navidrome_id || t.track_path,
      title: t.title,
      artist: t.artist,
      album: t.album,
      albumCover: t.artist && t.album
        ? `/api/cover/${encPath(t.artist)}/${encPath(t.album)}`
        : undefined,
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
            key={t.track_path}
            track={{
              title: t.title,
              artist: t.artist,
              album: t.album,
              duration: t.duration,
              path: t.track_path,
              navidrome_id: t.navidrome_id,
            }}
            index={i + 1}
            showArtist
            showAlbum
          />
        ))}
      </div>
    </div>
  );
}

export function Library() {
  const [tab, setTab] = useState<Tab>("playlists");
  const { data: stats } = useApi<MeStats>("/api/me");

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
