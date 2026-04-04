import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { TrackRow } from "@/components/cards/TrackRow";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";

import {
  type DecadeArtists,
  type GenreDetail,
  type SearchResults,
  type SystemPlaylist,
  loadSystemPlaylistTracks,
} from "./explore-model";

export function ExplorePill({
  label,
  count,
  onClick,
}: {
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <span className="text-sm font-medium text-primary">{label}</span>
      {count != null && count > 0 ? <span className="text-xs text-white/50">{count}</span> : null}
    </button>
  );
}

export function ExploreSectionHeader({
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
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {actionLabel}
          <ArrowRight size={15} />
        </button>
      ) : null}
    </div>
  );
}

export function ExploreSectionRail({ children }: { children: ReactNode }) {
  return (
    <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

export function ExploreLoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={24} className="animate-spin text-primary" />
    </div>
  );
}

export function SearchResultsView({ results }: { results: SearchResults }) {
  const hasArtists = results.artists.length > 0;
  const hasAlbums = results.albums.length > 0;
  const hasTracks = results.tracks.length > 0;

  if (!hasArtists && !hasAlbums && !hasTracks) {
    return <p className="mt-8 text-sm text-muted-foreground">No results found.</p>;
  }

  return (
    <div className="space-y-8">
      {hasArtists ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">Artists</h2>
          <ExploreSectionRail>
            {results.artists.map((artist) => (
              <ArtistCard
                key={artist.name}
                name={artist.name}
                subtitle={artist.album_count ? `${artist.album_count} albums` : undefined}
              />
            ))}
          </ExploreSectionRail>
        </div>
      ) : null}

      {hasAlbums ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">Albums</h2>
          <ExploreSectionRail>
            {results.albums.map((album) => (
              <AlbumCard
                key={album.id || `${album.artist}-${album.name}`}
                artist={album.artist}
                album={album.name}
                albumId={album.id}
                year={album.year}
              />
            ))}
          </ExploreSectionRail>
        </div>
      ) : null}

      {hasTracks ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">Tracks</h2>
          <div className="rounded-xl border border-white/5 bg-white/[0.02]">
            {results.tracks.slice(0, 10).map((track, index) => (
              <TrackRow
                key={`${track.artist}-${track.title}-${index}`}
                track={{
                  ...track,
                  path: track.path || "",
                  duration: track.duration || 0,
                  library_track_id: track.id,
                }}
                index={index + 1}
                showArtist
                showAlbum
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function GenreDetailView({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { data, loading } = useApi<GenreDetail>(`/api/genres/${slug}`);

  if (loading) return <ExploreLoadingState />;
  if (!data) return <p className="text-sm text-muted-foreground">Genre not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{data.name}</h1>
          <p className="text-sm text-muted-foreground">{data.artists.length} artists, {data.albums.length} albums</p>
        </div>
      </div>

      {data.artists.length > 0 ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">Artists</h2>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {data.artists.map((artist) => (
              <ArtistCard
                key={artist.artist_name}
                name={artist.artist_name}
                subtitle={`${artist.album_count} albums`}
                compact
                layout="grid"
              />
            ))}
          </div>
        </div>
      ) : null}

      {data.albums.length > 0 ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">Albums</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {data.albums.map((album) => (
              <AlbumCard
                key={album.album_id || `${album.artist}-${album.name}`}
                artist={album.artist}
                album={album.name}
                albumId={album.album_id}
                year={album.year}
                layout="grid"
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DecadeDetailView({ decade, onBack }: { decade: string; onBack: () => void }) {
  const { data, loading } = useApi<DecadeArtists>(`/api/artists?decade=${decade}&limit=50`);

  if (loading) return <ExploreLoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{decade}</h1>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} artists</p>
        </div>
      </div>

      {data && data.items.length > 0 ? (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {data.items.map((artist) => (
            <ArtistCard
              key={artist.name}
              name={artist.name}
              subtitle={`${artist.albums} albums`}
              compact
              layout="grid"
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No artists found for this decade.</p>
      )}
    </div>
  );
}

export function PlaylistCategoryView({
  category,
  onBack,
}: {
  category: string;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const { data, loading, refetch } = useApi<SystemPlaylist[]>(
    `/api/curation/playlists/category/${encodeURIComponent(category)}`,
  );

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

  if (loading) return <ExploreLoadingState />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/5 hover:text-white"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold capitalize">{category}</h1>
          <p className="text-sm text-muted-foreground">{data?.length ?? 0} playlists</p>
        </div>
      </div>

      {data && data.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {data.map((playlist) => (
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
              layout="grid"
              onPlay={() => handlePlayPlaylist(playlist.id, playlist.name)}
              onToggleFollow={() => handleToggleFollow(playlist.id, playlist.is_followed)}
              onClick={() => navigate(`/curation/playlist/${playlist.id}`)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
          No playlists found in this category yet.
        </div>
      )}
    </div>
  );
}
