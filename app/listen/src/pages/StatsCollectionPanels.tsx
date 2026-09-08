import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Disc3, Flame, Music2 } from "@crate/ui/icons";
import { Link } from "react-router";

import { CrateImage } from "@/components/artwork/CrateImage";
import {
  formatStatsMinutes,
  type StatsAlbum,
  type StatsArtist,
  type StatsTrack,
} from "@/components/stats/stats-model";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPhotoApiUrl,
  artistPagePath,
} from "@/lib/library-routes";
import { cn } from "@/lib/utils";

import {
  statsAlbumKey,
  statsArtistKey,
  statsTrackKey,
} from "./stats-collection-keys";

export function TopTracksPanel({
  items,
  loading,
  onPlayTrack,
}: {
  items: StatsTrack[];
  loading: boolean;
  onPlayTrack: (item: StatsTrack) => void;
}) {
  const { t } = useTranslation();
  return (
    <StatsPanel
      title={t("stats.topTracks.title")}
      subtitle={t("stats.topTracks.subtitle")}
      icon={Music2}
    >
      <div className="space-y-2">
        {loading ? (
          <PanelLoading />
        ) : items.length ? (
          items.map((item, index) => (
            <button
              key={statsTrackKey(item)}
              onClick={() => onPlayTrack(item)}
              className="stats-list-row group flex w-full items-center gap-3 rounded-lg border-transparent px-3 py-2.5 text-left transition"
            >
              <div className="w-7 text-center text-xs font-black text-text-muted">
                {index + 1}
              </div>
              <TrackCover item={item} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-text-primary">
                  {item.title}
                </div>
                <div className="truncate text-xs text-text-muted">
                  {item.artist} · {item.album}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-black text-text-primary">
                  {item.play_count}
                </div>
                <div className="text-xs text-text-muted">
                  {formatStatsMinutes(item.minutes_listened)}
                </div>
              </div>
            </button>
          ))
        ) : (
          <PanelEmpty text={t("stats.topTracks.empty")} />
        )}
      </div>
    </StatsPanel>
  );
}

export function TopArtistsPanel({
  items,
  loading,
}: {
  items: StatsArtist[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <StatsPanel
      title={t("stats.topArtists.title")}
      subtitle={t("stats.topArtists.subtitle")}
      icon={Flame}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        {loading ? (
          <PanelLoading />
        ) : items.length ? (
          items
            .slice(0, 6)
            .map((item, index) => (
              <TopArtistCard
                key={statsArtistKey(item)}
                item={item}
                index={index}
              />
            ))
        ) : (
          <PanelEmpty text={t("stats.topArtists.empty")} />
        )}
      </div>
    </StatsPanel>
  );
}

function TopArtistCard({ item, index }: { item: StatsArtist; index: number }) {
  const { t } = useTranslation();
  const photo = artistPhotoApiUrl(
    {
      artistId: item.artist_id,
      globalArtistUid: item.global_artist_uid,
      artistSlug: item.artist_slug,
      artistName: item.artist_name,
    },
    { size: 640 },
  );

  return (
    <Link
      to={artistPagePath({
        artistId: item.artist_id,
        globalArtistUid: item.global_artist_uid,
        artistSlug: item.artist_slug,
        artistName: item.artist_name,
      })}
      className="stats-artist-card group relative min-h-40 overflow-hidden rounded-xl p-4 transition"
    >
      {photo ? (
        <CrateImage
          src={photo}
          alt=""
          className="absolute inset-0 size-full object-cover grayscale opacity-55 transition duration-500 group-hover:scale-105 group-hover:opacity-70"
          loading="lazy"
        />
      ) : (
        <div className="stats-artist-placeholder absolute inset-0" />
      )}
      <div className="stats-artist-overlay absolute inset-0" />
      <div className="stats-artist-index absolute -bottom-6 -right-1 text-[8.5rem] font-black leading-none tracking-[-0.12em]">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="relative z-10 flex min-h-32 flex-col justify-between">
        <div className="text-xs font-black uppercase tracking-[0.22em] text-accent-action">
          {t("stats.rank", { rank: index + 1 })}
        </div>
        <div>
          <div className="stats-artist-title line-clamp-2 text-3xl font-black uppercase leading-[0.86] tracking-[-0.08em]">
            {item.artist_name}
          </div>
          <div className="stats-artist-meta mt-3 flex flex-wrap gap-2 text-xs font-bold uppercase tracking-[0.12em]">
            <span>{t("common.playCount", { count: item.play_count })}</span>
            <span>{formatStatsMinutes(item.minutes_listened)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function TopAlbumsPanel({
  items,
  loading,
}: {
  items: StatsAlbum[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <StatsPanel
      title={t("stats.topAlbums.title")}
      subtitle={t("stats.topAlbums.subtitle")}
      icon={Disc3}
      className="mt-8"
    >
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {loading ? (
          <PanelLoading />
        ) : items.length ? (
          items.slice(0, 12).map((item, index) => (
            <Link
              key={statsAlbumKey(item)}
              to={albumPagePath({
                albumId: item.album_id,
                globalAlbumUid: item.global_album_uid,
                albumSlug: item.album_slug,
                artistSlug: item.artist_slug,
                artistName: item.artist,
                albumName: item.album,
              })}
              className="group min-w-0"
            >
              <div className="stats-album-cover relative aspect-square overflow-hidden rounded-xl">
                {albumCoverApiUrl(
                  {
                    albumId: item.album_id,
                    globalAlbumUid: item.global_album_uid,
                    albumSlug: item.album_slug,
                    artistSlug: item.artist_slug,
                    artistName: item.artist,
                    albumName: item.album,
                  },
                  { size: 384 },
                ) ? (
                  <CrateImage
                    src={albumCoverApiUrl(
                      {
                        albumId: item.album_id,
                        globalAlbumUid: item.global_album_uid,
                        albumSlug: item.album_slug,
                        artistSlug: item.artist_slug,
                        artistName: item.artist,
                        albumName: item.album,
                      },
                      { size: 384 },
                    )}
                    alt=""
                    className=" size-full object-cover transition group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-accent-action">
                    <Disc3 size={28} />
                  </div>
                )}
                <div className="stats-album-rank absolute left-2 top-2 rounded-full px-2 py-1 text-xs font-black">
                  #{index + 1}
                </div>
              </div>
              <div className="mt-2 truncate text-sm font-semibold text-text-primary">
                {item.album}
              </div>
              <div className="truncate text-xs text-text-muted">
                {item.artist}
              </div>
            </Link>
          ))
        ) : (
          <PanelEmpty text={t("stats.topAlbums.empty")} />
        )}
      </div>
    </StatsPanel>
  );
}

function StatsPanel({
  title,
  subtitle,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("stats-card rounded-[12px] p-5", className)}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-[-0.04em] text-text-primary">
            {title}
          </h2>
          <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
        </div>
        <Icon className="text-accent-action" size={22} />
      </div>
      {children}
    </section>
  );
}

export function TrackCover({
  item,
  size = "md",
}: {
  item: StatsTrack;
  size?: "sm" | "md";
}) {
  const cover = albumCoverApiUrl(
    {
      albumId: item.album_id,
      globalAlbumUid: item.global_album_uid,
      albumSlug: item.album_slug,
      artistName: item.artist,
      albumName: item.album,
    },
    { size: 160 },
  );
  return (
    <div
      className={cn(
        "stats-track-cover shrink-0 overflow-hidden rounded-xl",
        size === "sm" ? "h-10 w-10" : "h-12 w-12",
      )}
    >
      {cover ? (
        <CrateImage
          src={cover}
          alt=""
          className=" size-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-accent-action">
          <Music2 size={size === "sm" ? 16 : 18} />
        </div>
      )}
    </div>
  );
}

export function PanelLoading() {
  const { t } = useTranslation();
  return (
    <div className="stats-card-empty rounded-lg border-dashed px-4 py-5 text-sm">
      {t("common.loadingShort")}
    </div>
  );
}

export function PanelEmpty({ text }: { text: string }) {
  return (
    <div className="stats-card-empty rounded-lg border-dashed px-4 py-5 text-sm">
      {text}
    </div>
  );
}
