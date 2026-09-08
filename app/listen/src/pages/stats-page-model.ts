import type { StatsTrack, StatsWindow } from "@/components/stats/stats-model";

export const WINDOW_COPY_KEYS: Record<
  StatsWindow,
  { title: string; label: string }
> = {
  "7d": { title: "stats.window.7d", label: "stats.window.week" },
  "30d": { title: "stats.window.30d", label: "stats.window.month" },
  "90d": { title: "stats.window.90d", label: "stats.window.season" },
  "365d": { title: "stats.window.365d", label: "stats.window.year" },
  all_time: { title: "stats.window.allTime", label: "stats.window.archive" },
};

export const STATS_WINDOWS: StatsWindow[] = [
  "7d",
  "30d",
  "90d",
  "365d",
  "all_time",
];

export interface StatsPeriod {
  label: string;
  title: string;
}

export interface SoundProfile {
  energy: number;
  danceability: number;
  valence: number;
  bpm: number | null;
}

export function normalizeWindowParam(value: string | null): StatsWindow {
  return STATS_WINDOWS.includes(value as StatsWindow)
    ? (value as StatsWindow)
    : "30d";
}

export function normalizeMonthParam(value: string | null): string | null {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : null;
}

export function formatMonthTitle(month: string, locale: string): string {
  const date = new Date(`${month}-01T12:00:00`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });
}

export function buildSoundProfile(items: StatsTrack[]): SoundProfile {
  const average = (field: "energy" | "danceability" | "valence") => {
    const values = items
      .map((item) => item[field])
      .filter((value): value is number => typeof value === "number");
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  const bpmValues = items
    .map((item) => item.bpm)
    .filter((value): value is number => typeof value === "number" && value > 0);

  return {
    energy: average("energy"),
    danceability: average("danceability"),
    valence: average("valence"),
    bpm: bpmValues.length
      ? Math.round(
          bpmValues.reduce((sum, value) => sum + value, 0) / bpmValues.length,
        )
      : null,
  };
}
