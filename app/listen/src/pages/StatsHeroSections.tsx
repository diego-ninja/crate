import { useTranslation } from "react-i18next";
import { Flame, Play, Repeat2, Search } from "@crate/ui/icons";

import type { StatsPageController } from "@/pages/use-stats-page-controller";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  formatStatsMinutes,
  type ReplayMix,
  type StatsTrack,
} from "@/components/stats/stats-model";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { cn } from "@/lib/utils";
import { MiniStat, SignalCard } from "./StatsAnalyticsSections";
import { TrackCover } from "./StatsCollectionPanels";
import { statsTrackKey } from "./stats-collection-keys";

const STATS_MOSAIC_CELL_IDS = [
  "top-left",
  "top-right",
  "middle-left",
  "middle-right",
  "bottom-left",
  "bottom-right",
  "footer-left",
  "footer-right",
] as const;

export function StatsHeroSection({ page }: { page: StatsPageController }) {
  return (
    <section className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
      <StatsHeroCover page={page} />
      <aside className="grid gap-4">
        <ReplayCard
          replay={page.replay}
          items={page.replayItems}
          loading={page.dashboardLoading}
          onPlay={page.playReplay}
          onPlayTrack={page.playTopTrack}
        />
        <StatsSignalCards page={page} />
      </aside>
    </section>
  );
}

function StatsHeroCover({ page }: { page: StatsPageController }) {
  const { leadArtist, leadGenre, overview, period, t } = page;

  return (
    <div className="stats-hero-surface relative min-h-[520px] overflow-hidden rounded-[12px] p-5 sm:p-7">
      <StatsCoverMosaic tracks={page.coverTracks} />
      <div className="stats-hero-overlay absolute inset-0" />
      <div className="relative z-10 flex min-h-[460px] flex-col justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="stats-hero-period-muted rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.18em]">
            {period.label}
          </span>
          <span className="stats-hero-period-accent rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.18em]">
            {period.title}
          </span>
        </div>
        <div>
          <div className="stats-hero-title max-w-3xl text-[clamp(3.8rem,13vw,10rem)] font-black uppercase leading-[0.75] tracking-[-0.04em]">
            {leadGenre?.genre_name || leadArtist?.artist_name || "Crate"}
          </div>
          <div className="mt-5 grid max-w-3xl gap-3 sm:grid-cols-3">
            <HeroMetric
              label={t("stats.metrics.minutes")}
              value={formatStatsMinutes(overview?.minutes_listened ?? 0)}
            />
            <HeroMetric
              label={t("stats.metrics.plays")}
              value={overview?.play_count ? String(overview.play_count) : "0"}
            />
            <HeroMetric
              label={t("stats.metrics.activeDays")}
              value={overview?.active_days ? String(overview.active_days) : "0"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsSignalCards({ page }: { page: StatsPageController }) {
  const { leadArtist, leadTrack, t, topDiscovery } = page;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
      <SignalCard
        icon={Flame}
        label={t("stats.signals.obsession")}
        title={leadTrack?.title || t("stats.signals.noDominantTrack")}
        body={
          leadTrack
            ? t("stats.signals.dominantTrackBody", {
                artist: leadTrack.artist,
                count: leadTrack.play_count,
              })
            : t("stats.signals.noDominantTrackBody")
        }
      />
      <SignalCard
        icon={Search}
        label={
          topDiscovery
            ? t("stats.signals.discovery")
            : t("stats.signals.gravity")
        }
        title={
          topDiscovery?.artist_name ||
          leadArtist?.artist_name ||
          t("stats.signals.noLeadingArtist")
        }
        body={
          topDiscovery
            ? t("stats.signals.discoveryBody", {
                count: topDiscovery.play_count,
              })
            : leadArtist
              ? t("stats.signals.gravityBody", {
                  minutes: formatStatsMinutes(leadArtist.minutes_listened),
                  count: leadArtist.play_count,
                })
              : t("stats.signals.noLeadingArtistBody")
        }
      />
    </div>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-hero-metric rounded-lg px-4 py-3 backdrop-blur">
      <div className="stats-hero-metric-label text-xs font-black uppercase tracking-[0.2em]">
        {label}
      </div>
      <div className="stats-hero-metric-value mt-1 text-2xl font-black tracking-[-0.04em]">
        {value}
      </div>
    </div>
  );
}

function StatsCoverMosaic({ tracks }: { tracks: StatsTrack[] }) {
  const covers = tracks
    .flatMap((track) => {
      const cover = albumCoverApiUrl(
        {
          albumId: track.album_id,
          globalAlbumUid: track.global_album_uid,
          albumSlug: track.album_slug,
          artistName: track.artist,
          albumName: track.album,
        },
        { size: 512 },
      );
      return cover ? [cover] : [];
    })
    .slice(0, 8);

  return (
    <div className="absolute inset-0 grid grid-cols-2 opacity-80 sm:grid-cols-4">
      {STATS_MOSAIC_CELL_IDS.map((cellId, index) => {
        const cover = covers[index % Math.max(covers.length, 1)];
        return (
          <div
            key={cellId}
            className={cn(
              "stats-mosaic-cell relative min-h-40 overflow-hidden",
              index % 3 === 0 && "scale-105",
            )}
          >
            {cover ? (
              <CrateImage
                src={cover}
                alt=""
                className=" size-full object-cover grayscale-[35%] saturate-[0.85]"
                loading={index < 4 ? "eager" : "lazy"}
              />
            ) : (
              <div className="stats-mosaic-placeholder size-full" />
            )}
            <div className="stats-mosaic-overlay absolute inset-0" />
          </div>
        );
      })}
    </div>
  );
}

function ReplayCard({
  replay,
  items,
  loading,
  onPlay,
  onPlayTrack,
}: {
  replay?: ReplayMix;
  items: StatsTrack[];
  loading: boolean;
  onPlay: () => void;
  onPlayTrack: (item: StatsTrack) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="stats-replay-card rounded-[12px] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="stats-replay-badge inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.2em]">
            <Repeat2 size={12} />
            {t("stats.replay.title")}
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-[-0.06em] text-text-primary">
            {replay?.title || t("stats.replay.title")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            {replay?.subtitle || t("stats.replay.defaultSubtitle")}
          </p>
        </div>
        <button
          onClick={onPlay}
          disabled={!items.length}
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-action text-accent-action-foreground shadow-xl shadow-primary/20 transition hover:scale-105 disabled:opacity-50"
        >
          <Play size={18} fill="currentColor" />
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <MiniStat
          label={t("common.tracks")}
          value={String(replay?.track_count ?? 0)}
        />
        <MiniStat
          label={t("stats.metrics.minutes")}
          value={formatStatsMinutes(replay?.minutes_listened ?? 0)}
        />
      </div>

      <div className="mt-5 space-y-2">
        {loading ? (
          <div className="stats-card-empty rounded-lg border-dashed px-4 py-5 text-sm">
            {t("stats.replay.loading")}
          </div>
        ) : items.length ? (
          items.slice(0, 5).map((item, index) => (
            <button
              key={statsTrackKey(item)}
              onClick={() => onPlayTrack(item)}
              className="stats-replay-row flex w-full items-center gap-3 rounded-lg border-transparent px-3 py-2.5 text-left transition"
            >
              <TrackCover item={item} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-text-primary">
                  {item.title}
                </div>
                <div className="truncate text-xs text-text-muted">
                  {item.artist}
                </div>
              </div>
              <div className="text-xs font-bold text-accent-action">
                {index + 1}
              </div>
            </button>
          ))
        ) : (
          <div className="stats-card-empty rounded-lg border-dashed px-4 py-5 text-sm">
            {t("stats.replay.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
