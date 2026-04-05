import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Plus, Heart, Users, Disc, ListMusic, Loader2, Play, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { TrackRow } from "@/components/cards/TrackRow";
import { PlaylistListRow } from "@/components/playlists/PlaylistListRow";
import { PlaylistCreateModal, type PlaylistComposerTrack } from "@/components/playlists/PlaylistCreateModal";
import { AppModal, ModalBody, ModalCloseButton, ModalFooter, ModalHeader } from "@/components/ui/AppModal";
import { type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { encPath, formatTotalDuration } from "@/lib/utils";

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

interface PlaylistTrack {
  id: number;
  track_id?: number;
  track_path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  navidrome_id?: string;
}

interface PlaylistDetail extends Playlist {
  tracks: PlaylistTrack[];
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
  const { data: playlists, loading, refetch: refetchPlaylists } = useApi<Playlist[]>("/api/playlists");
  const {
    data: followedCurated,
    loading: followedLoading,
    refetch: refetchFollowedCurated,
  } = useApi<CuratedPlaylist[]>("/api/curation/followed");
  const { openCreatePlaylist } = usePlaylistComposer();
  const [editingPlaylist, setEditingPlaylist] = useState<PlaylistDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingPlaylist, setDeletingPlaylist] = useState<Playlist | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (loading || followedLoading) return <Spinner />;

  async function toggleSystemPlaylistFollow(playlist: CuratedPlaylist) {
    try {
      const method = "DELETE";
      await api(`/api/curation/playlists/${playlist.id}/follow`, method);
      toast.success(`Removed ${playlist.name} from your library`);
      refetchFollowedCurated();
    } catch {
      toast.error("Failed to update playlist");
    }
  }

  async function openPlaylistEditor(playlistId: number) {
    try {
      const detail = await api<PlaylistDetail>(`/api/playlists/${playlistId}`);
      setEditingPlaylist(detail);
    } catch {
      toast.error("Failed to load playlist");
    }
  }

  async function handleSavePlaylist(payload: {
    name: string;
    description: string;
    coverDataUrl: string | null;
    tracks: PlaylistComposerTrack[];
  }) {
    if (!editingPlaylist) return;
    setSaving(true);
    try {
      await api(`/api/playlists/${editingPlaylist.id}`, "PUT", {
        name: payload.name,
        description: payload.description,
        cover_data_url: payload.coverDataUrl,
      });

      const originalByEntryId = new Map(
        editableTracks(editingPlaylist)
          .filter((track) => track.playlistEntryId != null)
          .map((track) => [track.playlistEntryId as number, track]),
      );

      const nextEntryIds = new Set(
        payload.tracks
          .map((track) => track.playlistEntryId)
          .filter((value): value is number => value != null),
      );

      const removedTracks = [...originalByEntryId.values()]
        .filter((track) => !nextEntryIds.has(track.playlistEntryId as number))
        .sort((a, b) => (b.playlistPosition || 0) - (a.playlistPosition || 0));

      for (const track of removedTracks) {
        if (track.playlistPosition != null) {
          await api(`/api/playlists/${editingPlaylist.id}/tracks/${track.playlistPosition}`, "DELETE");
        }
      }

      const newTracks = payload.tracks.filter((track) => track.playlistEntryId == null && track.path);
      if (newTracks.length > 0) {
        await api(`/api/playlists/${editingPlaylist.id}/tracks`, "POST", {
          tracks: newTracks.map((track) => ({
            path: track.path,
            title: track.title,
            artist: track.artist,
            album: track.album || "",
            duration: track.duration || 0,
          })),
        });
      }

      toast.success("Playlist updated");
      setEditingPlaylist(null);
      refetchPlaylists();
    } catch {
      toast.error("Failed to update playlist");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePlaylist() {
    if (!deletingPlaylist) return;
    setDeleting(true);
    try {
      await api(`/api/playlists/${deletingPlaylist.id}`, "DELETE");
      toast.success("Playlist deleted");
      setDeletingPlaylist(null);
      refetchPlaylists();
    } catch {
      toast.error("Failed to delete playlist");
    } finally {
      setDeleting(false);
    }
  }

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
            <PlaylistListRow
              key={`curated-${playlist.id}`}
              playlistId={playlist.id}
              name={playlist.name}
              description={playlist.description}
              coverDataUrl={playlist.cover_data_url}
              artworkTracks={playlist.artwork_tracks}
              trackCount={playlist.track_count}
              meta={[playlist.category, playlist.follower_count > 0 ? `${playlist.follower_count} followers` : null].filter(Boolean).join(" · ")}
              href={`/curation/playlist/${playlist.id}`}
              detailEndpoint={`/api/curation/playlists/${playlist.id}`}
              badge={playlist.is_smart ? "smart" : "curated"}
              followState={{
                isFollowed: true,
                onToggle: async () => toggleSystemPlaylistFollow(playlist),
              }}
            />
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
            <PlaylistListRow
              key={pl.id}
              playlistId={pl.id}
              name={pl.name}
              description={pl.description}
              coverDataUrl={pl.cover_data_url}
              artworkTracks={pl.artwork_tracks}
              trackCount={pl.track_count}
              meta={pl.total_duration > 0 ? formatTotalDuration(pl.total_duration) : undefined}
              href={`/playlist/${pl.id}`}
              detailEndpoint={`/api/playlists/${pl.id}`}
              badge={pl.is_smart ? "smart" : "personal"}
              extraActions={[
                {
                  key: "edit",
                  icon: Pencil,
                  title: "Edit",
                  onClick: async () => openPlaylistEditor(pl.id),
                },
                {
                  key: "delete",
                  icon: Trash2,
                  title: "Delete",
                  onClick: async () => setDeletingPlaylist(pl),
                  tone: "danger",
                },
              ]}
            />
          ))}
        </div>
      )}

      <PlaylistCreateModal
        open={!!editingPlaylist}
        mode="edit"
        initialName={editingPlaylist?.name}
        initialDescription={editingPlaylist?.description}
        initialCoverDataUrl={editingPlaylist?.cover_data_url}
        initialTracks={editingPlaylist ? editableTracks(editingPlaylist) : []}
        submitting={saving}
        onClose={() => setEditingPlaylist(null)}
        onSubmit={handleSavePlaylist}
      />

      <AppModal open={!!deletingPlaylist} onClose={() => !deleting && setDeletingPlaylist(null)} maxWidthClassName="sm:max-w-md">
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Delete playlist</h2>
            <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
          </div>
          <ModalCloseButton onClick={() => setDeletingPlaylist(null)} disabled={deleting} />
        </ModalHeader>
        <ModalBody className="px-5 py-5">
          <p className="text-sm text-muted-foreground">
            Delete <span className="font-medium text-foreground">{deletingPlaylist?.name}</span> and remove all its track entries?
          </p>
        </ModalBody>
        <ModalFooter className="flex items-center justify-end gap-3 px-5 py-4">
          <button
            type="button"
            className="rounded-xl px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
            onClick={() => setDeletingPlaylist(null)}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-500/90 transition-colors disabled:opacity-50"
            onClick={handleDeletePlaylist}
            disabled={deleting}
          >
            {deleting ? <Loader2 size={15} className="animate-spin" /> : null}
            Delete playlist
          </button>
        </ModalFooter>
      </AppModal>
    </div>
  );
}

function editableTracks(playlist: PlaylistDetail): PlaylistComposerTrack[] {
  return playlist.tracks.map((track) => ({
    title: track.title || "Unknown",
    artist: track.artist || "",
    album: track.album,
    duration: track.duration,
    path: track.track_path,
    libraryTrackId: track.track_id,
    navidromeId: track.navidrome_id,
    playlistEntryId: track.id,
    playlistPosition: track.position,
  }));
}

function ArtistsTab() {
  const { data: artists, loading } = useApi<FollowedArtist[]>("/api/me/follows");

  if (loading) return <Spinner />;
  if (!artists || artists.length === 0) {
    return <EmptyState message="You haven't followed any artists yet. Explore the library to find artists you love." />;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-5">
      {artists.map((a) => (
        <ArtistCard
          key={a.artist_name}
          name={a.artist_name}
          subtitle={`${a.album_count} album${a.album_count !== 1 ? "s" : ""}`}
          layout="grid"
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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-5">
      {albums.map((a) => (
        <AlbumCard
          key={a.id}
          artist={a.artist}
          album={a.name}
          albumId={a.id}
          year={a.year}
          layout="grid"
        />
      ))}
    </div>
  );
}

type LikedSort = "recent" | "title" | "artist" | "album";

function LikedTab() {
  const { likedTracks: tracks, loading } = useLikedTracks();
  const { playAll } = usePlayerActions();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<LikedSort>("recent");

  const filtered = useMemo(() => {
    if (!tracks) return [];
    let list = [...tracks];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.title?.toLowerCase().includes(q) ||
          t.artist?.toLowerCase().includes(q) ||
          t.album?.toLowerCase().includes(q),
      );
    }
    if (sort === "title") list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    else if (sort === "artist") list.sort((a, b) => (a.artist || "").localeCompare(b.artist || ""));
    else if (sort === "album") list.sort((a, b) => (a.album || "").localeCompare(b.album || ""));
    return list;
  }, [tracks, search, sort]);

  if (loading) return <Spinner />;
  if (!tracks || tracks.length === 0) {
    return <EmptyState message="No liked tracks yet. Tap the heart on any track to save it here." />;
  }

  function handlePlayAll() {
    const list = filtered.length ? filtered : tracks!;
    const playerTracks: Track[] = list.map((t) => ({
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
      <div className="flex items-center gap-2">
        <button
          onClick={handlePlayAll}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Play size={16} fill="currentColor" />
          Play {filtered.length < tracks.length ? `${filtered.length}` : "All"}
        </button>
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter liked tracks..."
            className="w-full h-10 pl-9 pr-3 rounded-lg bg-white/5 text-sm text-white placeholder:text-white/25 outline-none focus:bg-white/8"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as LikedSort)}
          className="h-10 rounded-lg bg-white/5 px-3 text-sm text-white/70 outline-none"
        >
          <option value="recent">Recent</option>
          <option value="title">Title</option>
          <option value="artist">Artist</option>
          <option value="album">Album</option>
        </select>
      </div>
      <div>
        {filtered.map((t, i) => (
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
      <div className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
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
