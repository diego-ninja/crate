import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";

import type { CuratedPlaylist, GlobalArtist, LibraryAddition } from "./home-model";
import { FeaturedPlaylistCard, SectionHeader, SectionLoading, SectionRail } from "./HomeSections";

export function FromCrateSection({
  playlists,
  loading,
  onOpenPlaylist,
}: {
  playlists?: CuratedPlaylist[];
  loading: boolean;
  onOpenPlaylist: (playlistId: number) => void;
}) {
  return (
    <section className="space-y-4">
      <SectionHeader
        title="From Crate"
        subtitle="Global smart and curated playlists published from admin."
      />
      {loading ? (
        <SectionLoading />
      ) : playlists && playlists.length > 0 ? (
        <SectionRail>
          {playlists.map((playlist) => (
            <FeaturedPlaylistCard
              key={playlist.id}
              name={playlist.name}
              description={playlist.description}
              tracks={playlist.artwork_tracks}
              meta={`${playlist.track_count} tracks${playlist.category ? ` · ${playlist.category}` : ""}`}
              badge={playlist.is_smart ? "Smart" : "Curated"}
              onClick={() => onOpenPlaylist(playlist.id)}
            />
          ))}
        </SectionRail>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
          No system playlists are available yet.
        </div>
      )}
    </section>
  );
}

export function HomeLibrarySection({
  additions,
  loading,
  onOpenLibrary,
  onPlayPlaylist,
  onToggleSystemPlaylistFollow,
  onOpenPlaylist,
  onOpenSystemPlaylist,
}: {
  additions: LibraryAddition[];
  loading: boolean;
  onOpenLibrary: () => void;
  onPlayPlaylist: (playlistId: number, isSystem: boolean, playlistName: string) => void;
  onToggleSystemPlaylistFollow: (playlistId: number) => void;
  onOpenPlaylist: (playlistId: number) => void;
  onOpenSystemPlaylist: (playlistId: number) => void;
}) {
  return (
    <section className="space-y-4">
      <SectionHeader
        title="In Your Library"
        subtitle="Your latest playlists and saved albums in one place."
        actionLabel="Go to Library"
        onAction={onOpenLibrary}
      />

      {loading ? (
        <SectionLoading />
      ) : additions.length > 0 ? (
        <SectionRail>
          {additions.map((item) => {
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
                  onPlay={() => onPlayPlaylist(item.playlist_id!, isSystem, item.playlist_name!)}
                  onToggleFollow={
                    isSystem
                      ? () => onToggleSystemPlaylistFollow(item.playlist_id!)
                      : undefined
                  }
                  onClick={() =>
                    isSystem
                      ? onOpenSystemPlaylist(item.playlist_id!)
                      : onOpenPlaylist(item.playlist_id!)
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
                  albumSlug={item.album_slug}
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
  );
}

export function JustLandedSection({
  artists,
  loading,
  onOpenExplore,
}: {
  artists?: GlobalArtist[];
  loading: boolean;
  onOpenExplore: () => void;
}) {
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Just landed"
        subtitle="Fresh additions arriving in the shared Crate library."
        actionLabel="Explore"
        onAction={onOpenExplore}
      />
      {loading ? (
        <SectionLoading />
      ) : artists?.length ? (
        <SectionRail>
          {artists.map((artist) => {
            const albumCount = artist.albums ?? artist.album_count ?? 0;
            const trackCount = artist.tracks ?? artist.track_count ?? 0;
            return (
              <ArtistCard
                key={`just-landed-${artist.id ?? artist.name}`}
                name={artist.name}
                artistId={artist.id}
                artistSlug={artist.slug}
                subtitle={`${albumCount} album${albumCount === 1 ? "" : "s"} · ${trackCount} tracks`}
              />
            );
          })}
        </SectionRail>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
          No recent global additions yet.
        </div>
      )}
    </section>
  );
}
