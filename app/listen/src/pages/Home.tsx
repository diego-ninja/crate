import { useNavigate } from "react-router";
import {
  ArrowRight,
  Calendar,
  Clock3,
  ListMusic,
  Loader2,
  Play,
  RadioTower,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { usePlayer, usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { encPath } from "@/lib/utils";

interface SavedAlbum {
  id: number;
  artist: string;
  name: string;
  year?: string;
  has_cover?: boolean;
  track_count?: number;
  saved_at?: string;
}

interface LibraryAddition {
  type: "album" | "playlist" | "system_playlist";
  added_at: string;
  album_id?: number;
  album_name?: string;
  album_artist?: string;
  album_year?: string;
  playlist_id?: number;
  playlist_name?: string;
  playlist_description?: string;
  playlist_tracks?: PlaylistArtworkTrack[];
  playlist_cover_data_url?: string | null;
  playlist_track_count?: number;
  playlist_follower_count?: number;
  playlist_badge?: string;
}

interface UserPlaylist {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  updated_at?: string;
  created_at?: string;
}

interface CuratedPlaylist {
  id: number;
  name: string;
  description?: string;
  category?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  follower_count: number;
  is_followed: boolean;
  is_smart: boolean;
  followed_at?: string;
  updated_at?: string;
}

interface GlobalArtist {
  name: string;
  albums?: number;
  tracks?: number;
  album_count?: number;
  track_count?: number;
  has_photo: boolean;
}

interface PaginatedArtistsResponse {
  items: GlobalArtist[];
  total: number;
  page: number;
  per_page: number;
}

interface UpcomingItem {
  id?: number;
  type: "release" | "show";
  date: string;
  artist: string;
  title: string;
  subtitle: string;
  is_upcoming: boolean;
  user_attending?: boolean;
}

interface UpcomingResponse {
  items: UpcomingItem[];
  summary: {
    followed_artists: number;
    show_count: number;
    release_count: number;
  };
}

interface PlaylistDetailTrack {
  id?: number;
  track_id?: number;
  track_path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  navidrome_id?: string;
}

interface PlaylistDetailData {
  id: number;
  name: string;
  cover_data_url?: string | null;
  tracks: PlaylistDetailTrack[];
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getDateString(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actionLabel && onAction ? (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {actionLabel}
          <ArrowRight size={15} />
        </button>
      ) : null}
    </div>
  );
}

function SectionRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      {children}
    </div>
  );
}

function SectionLoading() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 size={20} className="animate-spin text-primary" />
    </div>
  );
}

function UpcomingPreviewRow({
  item,
  onClick,
}: {
  item: UpcomingItem;
  onClick: () => void;
}) {
  const dateLabel = item.date
    ? new Date(`${item.date}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "Soon";

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-white/5"
    >
      <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
        <span className="text-[10px] uppercase tracking-wide text-white/35">{dateLabel.split(" ")[0]}</span>
        <span className="text-sm font-semibold text-foreground">{dateLabel.split(" ")[1] || ""}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {item.type === "show" ? item.artist : item.title}
          </span>
          {item.user_attending && item.type === "show" ? (
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              Going
            </span>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {item.type === "show" ? `${item.title} · ${item.subtitle}` : `${item.artist} · ${item.title}`}
        </div>
      </div>
      <div className="shrink-0 text-[10px] uppercase tracking-wider text-white/30">
        {item.type}
      </div>
    </button>
  );
}

function FeaturedPlaylistCard({
  name,
  description,
  tracks,
  coverDataUrl,
  meta,
  onClick,
  badge,
}: {
  name: string;
  description?: string;
  tracks?: PlaylistArtworkTrack[];
  coverDataUrl?: string | null;
  meta: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group w-[180px] flex-shrink-0 text-left"
    >
      <div className="relative">
        <PlaylistArtwork
          name={name}
          coverDataUrl={coverDataUrl}
          tracks={tracks}
          className="aspect-square rounded-3xl shadow-xl transition-transform group-hover:scale-[1.02]"
        />
        {badge ? (
          <div className="absolute left-3 top-3 rounded-full border border-primary/25 bg-[#0a0a0f]/80 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-primary backdrop-blur-md">
            {badge}
          </div>
        ) : null}
      </div>
      <div className="px-1 pt-3">
        <div className="truncate text-sm font-bold text-foreground">{name}</div>
        <div className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-muted-foreground">
          {description || meta}
        </div>
        <div className="mt-2 text-[11px] uppercase tracking-wider text-white/35">{meta}</div>
      </div>
    </button>
  );
}

function ContinueListeningCard({
  track,
  onPlay,
}: {
  track: Track;
  onPlay: () => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_55%)]" />
      <div className="relative flex items-center gap-4">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white/5">
          {track.albumCover ? (
            <img src={track.albumCover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white/5">
              <ListMusic size={24} className="text-white/20" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-wider text-white/45">
            <Clock3 size={11} />
            Continue listening
          </div>
          <h2 className="truncate text-xl font-bold text-foreground">{track.title}</h2>
          <p className="mt-1 truncate text-sm text-muted-foreground">{track.artist}</p>
          {track.album ? <p className="mt-1 truncate text-xs text-white/35">{track.album}</p> : null}
        </div>
        <button
          onClick={onPlay}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform group-hover:scale-105"
        >
          <Play size={18} fill="currentColor" className="ml-0.5" />
        </button>
      </div>
    </div>
  );
}

export function Home() {
  const navigate = useNavigate();
  const { currentTrack, recentlyPlayed } = usePlayer();
  const { play, playAll } = usePlayerActions();

  const { data: curatedPlaylists, loading: curatedLoading } =
    useApi<CuratedPlaylist[]>("/api/curation/playlists");
  const { data: followedCurated, loading: followedLoading, refetch: refetchFollowedCurated } =
    useApi<CuratedPlaylist[]>("/api/curation/followed");
  const { data: recentGlobalArtists, loading: globalArtistsLoading } =
    useApi<PaginatedArtistsResponse>("/api/artists?sort=recent&per_page=10");
  const { data: savedAlbums, loading: savedAlbumsLoading } =
    useApi<SavedAlbum[]>("/api/me/albums");
  const { data: playlists, loading: playlistsLoading } =
    useApi<UserPlaylist[]>("/api/playlists");
  const { data: upcoming } =
    useApi<UpcomingResponse>("/api/me/upcoming");

  const continueItems = currentTrack
    ? [currentTrack, ...recentlyPlayed.filter((track) => track.id !== currentTrack.id)]
    : recentlyPlayed;
  const continueLead = continueItems[0];
  const continueRail = continueItems.slice(1, 8);
  const upcomingPreview = (upcoming?.items || [])
    .filter((item) => item.is_upcoming)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 3);
  const libraryAdditions: LibraryAddition[] = [
    ...((playlists || []).map((playlist) => ({
      type: "playlist" as const,
      added_at: playlist.updated_at || playlist.created_at || "",
      playlist_id: playlist.id,
      playlist_name: playlist.name,
      playlist_description: playlist.description,
      playlist_tracks: playlist.artwork_tracks,
      playlist_cover_data_url: playlist.cover_data_url,
      playlist_track_count: playlist.track_count,
      playlist_badge: "Playlist",
    }))),
    ...((followedCurated || []).map((playlist) => ({
      type: "system_playlist" as const,
      added_at: playlist.followed_at || playlist.updated_at || "",
      playlist_id: playlist.id,
      playlist_name: playlist.name,
      playlist_description: playlist.description,
      playlist_tracks: playlist.artwork_tracks,
      playlist_track_count: playlist.track_count,
      playlist_follower_count: playlist.follower_count,
      playlist_badge: playlist.is_smart ? "Smart" : "Curated",
    }))),
    ...((savedAlbums || []).map((album) => ({
      type: "album" as const,
      added_at: album.saved_at || "",
      album_id: album.id,
      album_name: album.name,
      album_artist: album.artist,
      album_year: album.year,
      album_track_count: album.track_count,
    }))),
  ]
    .sort((a, b) => b.added_at.localeCompare(a.added_at))
    .slice(0, 14);
  const libraryAdditionsLoading =
    savedAlbumsLoading || playlistsLoading || followedLoading;

  async function handlePlayPlaylist(playlistId: number, systemPlaylist: boolean, playlistName: string) {
    try {
      const data = await api<PlaylistDetailData>(
        systemPlaylist ? `/api/curation/playlists/${playlistId}` : `/api/playlists/${playlistId}`,
      );
      const playerTracks: Track[] = (data.tracks || []).map((track) => ({
        id: track.track_path || String(track.id || track.track_id || Math.random()),
        title: track.title || "Unknown",
        artist: track.artist || "",
        album: track.album || "",
        albumCover:
          track.artist && track.album
            ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`
            : data.cover_data_url || undefined,
        path: track.track_path,
        libraryTrackId: track.track_id,
        navidromeId: track.navidrome_id,
      }));
      if (playerTracks.length > 0) {
        playAll(playerTracks, 0, { type: "playlist", name: playlistName });
      }
    } catch {
      toast.error("Failed to play playlist");
    }
  }

  async function handleToggleSystemPlaylistFollow(playlistId: number, isFollowed: boolean) {
    try {
      await api(`/api/curation/playlists/${playlistId}/follow`, isFollowed ? "DELETE" : "POST");
      toast.success(isFollowed ? "Removed from your library" : "Added to your library");
      refetchFollowedCurated();
    } catch {
      toast.error("Failed to update playlist");
    }
  }

  return (
    <div className="space-y-10">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{getGreeting()}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{getDateString()}</p>
        </div>

        {continueLead ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
            <ContinueListeningCard
              track={continueLead}
              onPlay={() => play(continueLead, { type: "track", name: "Continue Listening" })}
            />

            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/40">
                <Clock3 size={12} />
                Recent listens
              </div>
              <div className="space-y-1">
                {continueRail.length > 0 ? continueRail.slice(0, 4).map((track) => (
                  <button
                    key={track.id}
                    onClick={() => play(track, { type: "track", name: "Recent Listening" })}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-white/5"
                  >
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-white/5">
                      {track.albumCover ? (
                        <img src={track.albumCover} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-white/5">
                          <ListMusic size={16} className="text-white/20" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{track.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
                    </div>
                    <Play size={15} className="shrink-0 text-white/30" />
                  </button>
                )) : (
                  <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-muted-foreground">
                    Start playing music and your listening history will show up here.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_50%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-6">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-primary">
                <Sparkles size={12} />
                Start listening
              </div>
              <h2 className="text-2xl font-bold text-foreground">Your home should feel alive as soon as playback starts.</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Play an album, a playlist, or a curated mix and this screen will turn into your real listening surface:
                continuity, smart picks, and system playlists from Crate.
              </p>
            </div>
          </div>
        )}
      </div>

      {upcomingPreview.length > 0 ? (
        <section className="space-y-4">
          <SectionHeader
            title="Upcoming"
            subtitle="Next shows and releases from the artists you follow."
            actionLabel="Open Upcoming"
            onAction={() => navigate("/upcoming")}
          />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.16),transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
                <RadioTower size={12} />
                From your artists
              </div>
              <h2 className="text-2xl font-bold text-foreground">
                {upcomingPreview[0]?.type === "show" ? upcomingPreview[0]?.artist : upcomingPreview[0]?.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {upcomingPreview[0]?.type === "show"
                  ? `${upcomingPreview[0]?.title} · ${upcomingPreview[0]?.subtitle}`
                  : `${upcomingPreview[0]?.artist} · ${upcomingPreview[0]?.subtitle}`}
              </p>
              <button
                onClick={() => navigate("/upcoming")}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Calendar size={15} />
                View details
              </button>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/40">
                <Calendar size={12} />
                Next up
              </div>
              <div className="space-y-1">
                {upcomingPreview.map((item) => (
                  <UpcomingPreviewRow
                    key={`${item.type}-${item.artist}-${item.title}-${item.date}`}
                    item={item}
                    onClick={() => navigate("/upcoming")}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <SectionHeader
          title="From Crate"
          subtitle="Global smart and curated playlists published from admin."
        />
        {curatedLoading ? (
          <SectionLoading />
        ) : curatedPlaylists && curatedPlaylists.length > 0 ? (
          <SectionRail>
            {curatedPlaylists.map((playlist) => (
              <FeaturedPlaylistCard
                key={playlist.id}
                name={playlist.name}
                description={playlist.description}
                tracks={playlist.artwork_tracks}
                meta={`${playlist.track_count} tracks${playlist.category ? ` · ${playlist.category}` : ""}`}
                badge={playlist.is_smart ? "Smart" : "Curated"}
                onClick={() => navigate(`/curation/playlist/${playlist.id}`)}
              />
            ))}
          </SectionRail>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
            No system playlists are available yet.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="In Your Library"
          subtitle="Your latest playlists and saved albums in one place."
          actionLabel="Go to Library"
          onAction={() => navigate("/library")}
        />

        {libraryAdditionsLoading ? (
          <SectionLoading />
        ) : libraryAdditions.length > 0 ? (
          <SectionRail>
            {libraryAdditions.map((item) => {
              if (
                (item.type === "playlist" || item.type === "system_playlist") &&
                item.playlist_id &&
                item.playlist_name
              ) {
                const isSystem = item.type === "system_playlist";
                const playlistMeta = isSystem
                  ? `${item.playlist_track_count || 0} tracks${item.playlist_follower_count != null ? ` · ${item.playlist_follower_count} followers` : ""}`
                  : `${item.playlist_track_count || 0} tracks`;
                return (
                  <PlaylistCard
                    key={`${item.type}-${item.playlist_id}-${item.added_at}`}
                    name={item.playlist_name}
                    description={item.playlist_description}
                    tracks={item.playlist_tracks}
                    coverDataUrl={item.playlist_cover_data_url}
                    meta={playlistMeta}
                    systemPlaylist={isSystem}
                    isFollowed={isSystem}
                    badge={item.playlist_badge}
                    onPlay={() => handlePlayPlaylist(item.playlist_id!, isSystem, item.playlist_name!)}
                    onToggleFollow={
                      isSystem
                        ? () => handleToggleSystemPlaylistFollow(item.playlist_id!, true)
                        : undefined
                    }
                    onClick={() =>
                      navigate(isSystem ? `/curation/playlist/${item.playlist_id}` : `/playlist/${item.playlist_id}`)
                    }
                  />
                );
              }

              if (item.album_id && item.album_name && item.album_artist) {
                return (
                  <AlbumCard
                    key={`album-${item.album_id}-${item.added_at}`}
                    artist={item.album_artist}
                    album={item.album_name}
                    albumId={item.album_id}
                    year={item.album_year}
                  />
                );
              }

              return null;
            })}
          </SectionRail>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
            Start saving albums or creating playlists and they will show up here.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Just landed"
          subtitle="Fresh additions arriving in the shared Crate library."
          actionLabel="Explore"
          onAction={() => navigate("/explore")}
        />
        {globalArtistsLoading ? (
          <SectionLoading />
        ) : recentGlobalArtists?.items?.length ? (
          <SectionRail>
            {recentGlobalArtists.items.map((artist) => (
              <ArtistCard
                key={`just-landed-${artist.name}`}
                name={artist.name}
                subtitle={`${artist.albums ?? artist.album_count ?? 0} album${(artist.albums ?? artist.album_count ?? 0) === 1 ? "" : "s"} · ${artist.tracks ?? artist.track_count ?? 0} tracks`}
              />
            ))}
          </SectionRail>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
            No recent global additions yet.
          </div>
        )}
      </section>

      {continueRail.length > 0 ? (
        <section className="space-y-4">
          <SectionHeader
            title="Keep the queue moving"
            subtitle="Quick picks from your own recent listening."
          />
          <SectionRail>
            {continueRail.map((track) => (
              <button
                key={track.id}
                onClick={() => play(track, { type: "track", name: "Quick Pick" })}
                className="group w-[220px] flex-shrink-0 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] text-left"
              >
                <div className="flex items-center gap-3 p-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white/5">
                    {track.albumCover ? (
                      <img src={track.albumCover} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-white/5">
                        <ListMusic size={18} className="text-white/20" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">{track.title}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{track.artist}</div>
                    {track.album ? <div className="mt-1 truncate text-[11px] text-white/35">{track.album}</div> : null}
                  </div>
                </div>
              </button>
            ))}
          </SectionRail>
        </section>
      ) : null}
    </div>
  );
}
