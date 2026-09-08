import { useTranslation } from "react-i18next";
import { CalendarDays } from "@crate/ui/icons";

import {
  formatStatsMinutes,
  formatStatsPercent,
  type StatsStory,
  type StatsTrendPoint,
} from "@/components/stats/stats-model";
import { cn } from "@/lib/utils";
import { PanelEmpty, PanelLoading } from "./StatsCollectionPanels";
import { formatWeekdayLabel } from "./stats-time-formatters";
import { MiniStat } from "./StatsAnalyticsPrimitives";

export function ListeningPulseCard({
  story,
  points,
  loading,
}: {
  story?: StatsStory;
  points: StatsTrendPoint[];
  loading: boolean;
}) {
  const { t, i18n } = useTranslation();
  const activePoints = points.filter(
    (point) => point.play_count > 0 || point.minutes_listened > 0,
  );
  const strongestDay = activePoints.reduce<StatsTrendPoint | null>(
    (strongest, point) =>
      !strongest || point.minutes_listened > strongest.minutes_listened
        ? point
        : strongest,
    null,
  );
  const totalMinutes = points.reduce(
    (sum, point) => sum + point.minutes_listened,
    0,
  );
  const averageActiveMinutes = activePoints.length
    ? totalMinutes / activePoints.length
    : 0;
  const consistency = points.length ? activePoints.length / points.length : 0;
  const rhythm = story?.rhythm;

  return (
    <div className="stats-card rounded-[12px] p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-[-0.04em] text-text-primary">
            {t("stats.rhythm.title")}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {t("stats.rhythm.subtitle")}
          </p>
        </div>
        <CalendarDays className="text-accent-action" size={22} />
      </div>

      {loading ? (
        <PanelLoading />
      ) : activePoints.length ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat
              label={t("stats.rhythm.strongestDay")}
              value={
                strongestDay
                  ? formatTrendDay(strongestDay.day, i18n.language)
                  : "—"
              }
            />
            <MiniStat
              label={t("stats.rhythm.peakHour")}
              value={rhythm?.peak_hour_label ?? "—"}
            />
            <MiniStat
              label={t("stats.rhythm.avgActiveDay")}
              value={formatStatsMinutes(averageActiveMinutes)}
            />
          </div>

          <PulseConstellation points={points} />

          <div className="stats-dark-card mt-4 rounded-xl p-4">
            <div className="text-xs font-black uppercase tracking-[0.22em] text-accent-action">
              {t("stats.rhythm.cadence")}
            </div>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              {t("stats.rhythm.activityDays", {
                percent: formatStatsPercent(consistency),
              })}
              {rhythm?.peak_weekday
                ? ` ${t("stats.rhythm.strongestWeekday", {
                    weekday: formatWeekdayLabel(
                      rhythm.peak_weekday,
                      i18n.language,
                    ),
                  })}`
                : ""}
            </p>
          </div>
        </>
      ) : (
        <PanelEmpty text={t("stats.rhythm.empty")} />
      )}
    </div>
  );
}

function PulseConstellation({ points }: { points: StatsTrendPoint[] }) {
  const { t, i18n } = useTranslation();
  const visible = points.slice(-18);
  const maxMinutes = Math.max(
    ...visible.map((point) => point.minutes_listened),
    1,
  );
  const coordinates = visible.map((point, index) => {
    const intensity = Math.min(1, point.minutes_listened / maxMinutes);
    const x = visible.length > 1 ? 5 + (index / (visible.length - 1)) * 90 : 50;
    const y = 78 - intensity * 52;
    return { point, intensity, x, y };
  });
  const polyline = coordinates
    .map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");

  return (
    <div className="stats-pulse-surface mt-5 rounded-[12px] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.22em] text-accent-action">
            {t("stats.rhythm.dailySignalMap")}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {t("stats.rhythm.dailySignalDescription")}
          </p>
        </div>
        <div className="stats-muted-pill rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.14em]">
          {t("stats.rhythm.dayCount", { count: visible.length })}
        </div>
      </div>

      <div className="stats-pulse-plot relative h-36 rounded-xl">
        <div className="stats-pulse-grid pointer-events-none absolute inset-3 rounded-xl opacity-50" />
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline
            points={polyline}
            fill="none"
            className="stats-pulse-line"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {coordinates.map(({ point, intensity, x, y }, index) => {
          const size = 0.65 + intensity * 1.25;
          const completionRate = point.play_count
            ? point.complete_play_count / point.play_count
            : 0;
          const skipRate = point.play_count
            ? point.skip_count / point.play_count
            : 0;
          const isActive = point.play_count > 0 || point.minutes_listened > 0;

          return (
            <div
              key={point.day}
              className="group absolute z-10 -translate-x-1/2 -translate-y-1/2 hover:z-40 focus-within:z-40"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <button
                type="button"
                className={cn(
                  "relative flex h-10 w-10 items-center justify-center rounded-full outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-primary/70",
                  isActive
                    ? "text-accent-action hover:scale-110"
                    : "stats-pulse-point-idle",
                )}
                aria-label={`${formatTrendDay(
                  point.day,
                  i18n.language,
                )}: ${formatStatsMinutes(point.minutes_listened)}, ${t(
                  "common.playCount",
                  { count: point.play_count },
                )}`}
              >
                <span
                  className={cn(
                    "absolute rounded-full blur-md transition",
                    isActive
                      ? "bg-accent-action/25"
                      : "stats-pulse-point-idle-glow",
                  )}
                  style={{
                    height: `${size * 1.45}rem`,
                    width: `${size * 1.45}rem`,
                  }}
                />
                <span
                  className={cn(
                    "relative rounded-full border transition",
                    isActive
                      ? "stats-pulse-point-active border-accent-action/55 bg-accent-action"
                      : "stats-pulse-point-idle-dot",
                  )}
                  style={{ height: `${size}rem`, width: `${size}rem` }}
                />
              </button>

              <div
                className={cn(
                  "stats-pulse-tooltip pointer-events-none absolute bottom-full z-app-popover mb-3 w-64 -translate-x-1/2 rounded-[12px] p-3 text-left opacity-0 backdrop-blur transition group-hover:opacity-100 group-focus-within:opacity-100",
                  index < 2
                    ? "left-0 translate-x-0"
                    : index > coordinates.length - 3
                      ? "right-0 translate-x-0"
                      : "left-1/2",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="stats-pulse-tooltip-title text-sm font-black">
                      {formatTrendDay(point.day, i18n.language)}
                    </div>
                    <div className="mt-0.5 text-xs font-black uppercase tracking-[0.18em] text-accent-action">
                      {formatShortWeekday(point.day, i18n.language)}
                    </div>
                  </div>
                  <div className="rounded-full border border-accent-action/20 bg-accent-action/10 px-2.5 py-1 text-xs font-black text-accent-action">
                    {formatStatsMinutes(point.minutes_listened)}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <TooltipMetric
                    label={t("stats.metrics.plays")}
                    value={String(point.play_count)}
                  />
                  <TooltipMetric
                    label={t("stats.rhythm.done")}
                    value={String(point.complete_play_count)}
                  />
                  <TooltipMetric
                    label={t("stats.rhythm.skips")}
                    value={String(point.skip_count)}
                  />
                </div>
                <div className="mt-3 space-y-2">
                  <TooltipMeter
                    label={t("stats.rhythm.completion")}
                    value={completionRate}
                  />
                  <TooltipMeter
                    label={t("stats.rhythm.skipPressure")}
                    value={skipRate}
                  />
                </div>
                <div className="mt-3 text-xs leading-5 text-text-muted">
                  {isActive
                    ? t("stats.rhythm.completedAcross", {
                        complete: point.complete_play_count,
                        total: point.play_count,
                      })
                    : t("stats.rhythm.noDaySignal")}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TooltipMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-tooltip-metric rounded-xl px-2.5 py-2">
      <div className="stats-tooltip-label text-xs font-black uppercase tracking-[0.16em]">
        {label}
      </div>
      <div className="stats-tooltip-value mt-1 text-sm font-black">{value}</div>
    </div>
  );
}

function TooltipMeter({ label, value }: { label: string; value: number }) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div>
      <div className="stats-tooltip-meter-label mb-1 flex items-center justify-between text-xs font-bold uppercase tracking-[0.12em]">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div className="stats-tooltip-meter-track h-1.5 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full bg-accent-action"
          style={{ width: `${Math.max(3, percent)}%` }}
        />
      </div>
    </div>
  );
}

function formatTrendDay(day: string, locale: string): string {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

function formatShortWeekday(day: string, locale: string): string {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, { weekday: "long" });
}
