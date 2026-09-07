import { useTranslation } from "react-i18next";

import type { StatsPageController } from "@/pages/use-stats-page-controller";
import type {
  StatsStory,
  StatsStoryArtistSignal,
} from "@/components/stats/stats-model";
import { formatWeekdayLabel } from "./stats-time-formatters";

type StorySignal = {
  key: string;
  label: string;
  title: string;
  body: string;
};

export function StatsStorySection({
  story,
  fallbackMover,
  fallbackDiscovery,
  fallbackComeback,
}: {
  story?: StatsStory;
  fallbackMover?: StatsStoryArtistSignal;
  fallbackDiscovery?: StatsStoryArtistSignal;
  fallbackComeback?: StatsStoryArtistSignal;
}) {
  const { t, i18n } = useTranslation();
  const signals = story
    ? buildStorySignals({
        story,
        fallbackMover,
        fallbackDiscovery,
        fallbackComeback,
        locale: i18n.language,
        t,
      })
    : [];

  if (!signals.length) return null;

  return (
    <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {signals.map(({ key, label, title, body }) => (
        <StorySignalCard key={key} label={label} title={title} body={body} />
      ))}
    </section>
  );
}

function buildStorySignals({
  story,
  fallbackMover,
  fallbackDiscovery,
  fallbackComeback,
  locale,
  t,
}: {
  story: StatsStory;
  fallbackMover?: StatsStoryArtistSignal;
  fallbackDiscovery?: StatsStoryArtistSignal;
  fallbackComeback?: StatsStoryArtistSignal;
  locale: string;
  t: StatsPageController["t"];
}): StorySignal[] {
  const mover = fallbackMover ?? story.movers[0];
  const discovery = fallbackDiscovery ?? story.discoveries[0];
  const comeback = fallbackComeback ?? story.comebacks[0];
  const rhythm = story.rhythm;

  if (!mover && !discovery && !comeback && !rhythm.peak_hour_label) {
    return [];
  }

  return [
    {
      key: "rising",
      label: t("stats.story.rising"),
      title: mover?.artist_name || t("stats.story.noSurge"),
      body: mover?.delta_play_count
        ? t("stats.story.risingBody", { count: mover.delta_play_count })
        : t("stats.story.risingFallback"),
    },
    {
      key: "new-blood",
      label: t("stats.story.newBlood"),
      title: discovery?.artist_name || t("stats.story.noNewObsession"),
      body: discovery
        ? t("stats.story.discoveryBody", { count: discovery.play_count })
        : t("stats.story.discoveryFallback"),
    },
    {
      key: "comeback",
      label: t("stats.story.comeback"),
      title: comeback?.artist_name || t("stats.story.noComeback"),
      body: comeback
        ? t("stats.story.comebackBody", { count: comeback.play_count })
        : t("stats.story.comebackFallback"),
    },
    {
      key: "peak-ritual",
      label: t("stats.story.peakRitual"),
      title:
        rhythm.peak_hour_label ||
        rhythm.peak_weekday ||
        t("stats.story.noRhythm"),
      body: rhythm.peak_weekday
        ? t("stats.story.rhythmBody", {
            weekday: formatWeekdayLabel(rhythm.peak_weekday, locale),
            hour: rhythm.peak_hour_label ?? t("stats.story.peakHour"),
          })
        : t("stats.story.rhythmFallback"),
    },
  ];
}

function StorySignalCard({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body: string;
}) {
  return (
    <div className="stats-card relative overflow-hidden rounded-[12px] p-5">
      <div className="relative">
        <div className="text-xs font-black uppercase tracking-[0.22em] text-accent-action">
          {label}
        </div>
        <div className="mt-3 line-clamp-2 text-2xl font-black uppercase leading-[0.9] tracking-[-0.07em] text-text-primary">
          {title}
        </div>
        <p className="mt-3 text-sm leading-6 text-text-muted">{body}</p>
      </div>
    </div>
  );
}
