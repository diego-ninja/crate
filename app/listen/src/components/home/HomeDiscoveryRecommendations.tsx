import { useTranslation } from "react-i18next";
import { Play, Sparkles } from "@crate/ui/icons";

import {
  ItemActionMenu,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { CoreTracksArtwork } from "@/components/home/CoreTracksArtwork";
import {
  SectionHeader,
  SectionRail,
  useSectionRail,
} from "@/components/home/HomeSections";
import { cn } from "@/lib/utils";

import type {
  HomeDiscoveryPayload,
  HomeGeneratedPlaylistSummary,
  HomeSectionId,
} from "./home-model";

function chunkItems<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function RecommendedTracksSection({
  tracks,
  onViewAll,
}: {
  tracks: TrackRowData[];
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const pages = chunkItems(tracks, 9);
  const rail = useSectionRail(pages.length);
  if (!tracks.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.recommendedTracks.title")}
        subtitle={t("home.sections.recommendedTracks.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("recommended-tracks")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef}>
        {pages.map((pageTracks, pageIndex) => (
          <div
            key={`recommended-page-${pageIndex}`}
            className="min-w-full snap-start"
          >
            <div className="grid gap-2 xl:grid-cols-3">
              {pageTracks.map((track) => (
                <TrackRow
                  key={
                    track.library_track_id ??
                    track.global_track_uid ??
                    track.entity_uid ??
                    track.path ??
                    [track.artist, track.album, track.title].join(":")
                  }
                  track={track}
                  showArtist
                  showAlbum
                  showCoverThumb
                  queueTracks={pageTracks}
                />
              ))}
            </div>
          </div>
        ))}
      </SectionRail>
    </section>
  );
}

export function FavoriteArtistsSection({
  artists,
  onViewAll,
}: {
  artists: HomeDiscoveryPayload["favorite_artists"];
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const rail = useSectionRail(artists.length);
  if (!artists.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.favoriteArtists.title")}
        subtitle={t("home.sections.favoriteArtists.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("favorite-artists")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} fit="square-card">
        {artists.map((artist) => (
          <ArtistCard
            key={
              artist.global_artist_uid ?? artist.artist_id ?? artist.artist_name
            }
            name={artist.artist_name}
            artistId={artist.artist_id}
            globalArtistUid={artist.global_artist_uid}
            artistEntityUid={artist.artist_entity_uid}
            artistSlug={artist.artist_slug}
            subtitle={t("common.playCount", { count: artist.play_count })}
            layout="grid"
            fillGrid
          />
        ))}
      </SectionRail>
    </section>
  );
}

export function CoreTracksPlaylistCard({
  item,
  onOpenPlaylist,
  onPlayPlaylist,
  onShufflePlaylist,
  onStartRadio,
  layout = "rail",
}: {
  item: HomeGeneratedPlaylistSummary;
  onOpenPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onPlayPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onShufflePlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (item: HomeGeneratedPlaylistSummary) => void;
  layout?: "rail" | "grid";
}) {
  const { t } = useTranslation();
  const href = `/home/playlist/${encodeURIComponent(item.id)}`;
  const actions = usePlaylistActionEntries({
    name: item.name,
    href,
    onPlay: () => onPlayPlaylist(item),
    onShuffle: () => onShufflePlaylist(item),
    onStartRadio: () => onStartRadio(item),
  });
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenPlaylist(item)}
      onKeyDown={(event) => {
        actionMenu.handleKeyboardTrigger(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenPlaylist(item);
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      {...actionMenu.longPressHandlers}
      className={cn(
        "group cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/40 focus-visible:rounded-xl",
        layout === "grid" ? "w-full min-w-0" : "w-full min-w-0 snap-start",
      )}
    >
      <div className="home-discovery-artwork relative mb-2 overflow-hidden rounded-xl">
        <CoreTracksArtwork
          item={item}
          className="aspect-square rounded-xl transition-transform group-hover:scale-[1.02]"
        />
        <div className="home-discovery-artwork-overlay absolute inset-0 flex items-center justify-center">
          <button
            className="home-discovery-play-button flex size-10 translate-y-2 items-center justify-center rounded-full opacity-0 shadow-lg transition-[transform,opacity] focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-action group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onPlayPlaylist(item);
            }}
          >
            <Play
              size={18}
              fill="currentColor"
              className="ml-0.5 text-accent-action-foreground"
            />
          </button>
        </div>
      </div>
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: item.name,
          subtitle: t("common.trackCount", { count: item.track_count }),
          imageShape: "square",
          fallbackIcon: Sparkles,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}

export function EssentialsSection({
  items,
  onOpenPlaylist,
  onPlayPlaylist,
  onShufflePlaylist,
  onStartRadio,
  onViewAll,
}: {
  items: HomeGeneratedPlaylistSummary[];
  onOpenPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onPlayPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onShufflePlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (item: HomeGeneratedPlaylistSummary) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const rail = useSectionRail(items.length);
  if (!items.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.artistSets.title")}
        subtitle={t("home.sections.artistSets.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("core-tracks")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} fit="square-card">
        {items.map((item) => (
          <CoreTracksPlaylistCard
            key={item.id}
            item={item}
            onOpenPlaylist={onOpenPlaylist}
            onPlayPlaylist={onPlayPlaylist}
            onShufflePlaylist={onShufflePlaylist}
            onStartRadio={onStartRadio}
          />
        ))}
      </SectionRail>
    </section>
  );
}
