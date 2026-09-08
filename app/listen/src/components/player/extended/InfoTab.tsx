import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "@crate/ui/icons";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { useTrackInfo } from "@/hooks/use-track-info";
import { extractPalette } from "@/lib/palette";

import { InfoTabHero } from "./InfoTabHero";
import { InfoTabAnalysisGrid } from "./InfoTabSections";
import { InfoTabQuietMetrics } from "./InfoTabQuietMetrics";
import { InfoTabReach } from "./InfoTabReach";
import {
  type PaletteTriplet,
  formatBitDepth,
  formatBitrate,
  formatKey,
  formatSampleRate,
  hasTrackAnalysis,
  parseMoodEntries,
} from "./info-tab-data";
import { cn } from "@/lib/utils";

export function InfoTab({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { currentTrack } = usePlayerActions();
  const { info, loading } = useTrackInfo(currentTrack);
  const [palette, setPalette] = useState<{
    primary: PaletteTriplet;
    secondary: PaletteTriplet;
    accent: PaletteTriplet;
  } | null>(null);

  useEffect(() => {
    if (!currentTrack?.albumCover) {
      setPalette(null);
      return;
    }

    let cancelled = false;
    extractPalette(currentTrack.albumCover)
      .then(([primary, secondary, accent]) => {
        if (!cancelled) setPalette({ primary, secondary, accent });
      })
      .catch(() => {
        if (!cancelled) setPalette(null);
      });

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.albumCover]);

  const moodEntries = useMemo(
    () => parseMoodEntries(info?.mood_json ?? null),
    [info?.mood_json],
  );
  const topMoods = moodEntries.slice(0, 5);

  const audioSummary = useMemo(() => {
    const items: string[] = [];
    if (info?.bpm) items.push(`${Math.round(info.bpm)} BPM`);
    const musicalKey = formatKey(info?.audio_key, info?.audio_scale);
    if (musicalKey) items.push(musicalKey);
    if (info?.format) items.push(String(info.format).toUpperCase());
    return items;
  }, [info?.audio_key, info?.audio_scale, info?.bpm, info?.format]);

  const qualityPills = useMemo(
    () =>
      [
        formatBitrate(info?.bitrate ?? currentTrack?.bitrate),
        formatSampleRate(info?.sample_rate ?? currentTrack?.sampleRate),
        formatBitDepth(info?.bit_depth ?? currentTrack?.bitDepth),
      ].filter((value): value is string => Boolean(value)),
    [
      currentTrack?.bitDepth,
      currentTrack?.bitrate,
      currentTrack?.sampleRate,
      info?.bit_depth,
      info?.bitrate,
      info?.sample_rate,
    ],
  );

  const primary = palette?.primary ?? [0.024, 0.714, 0.831];
  const secondary = palette?.secondary ?? [0.4, 0.9, 1];
  const accent = palette?.accent ?? [0.98, 0.74, 0.24];

  if (loading) {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 flex-1 items-center justify-center",
          className,
        )}
      >
        <Loader2 size={20} className="animate-spin text-accent-action" />
      </div>
    );
  }

  if (!info || !currentTrack) {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 flex-1 items-center justify-center text-sm text-text-faint",
          className,
        )}
      >
        {t("player.info.empty")}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "hide-rail-scrollbar h-full min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1",
        className,
      )}
    >
      <div className="space-y-4 pb-2">
        <InfoTabHero
          info={info}
          currentTrack={currentTrack}
          audioSummary={audioSummary}
          qualityPills={qualityPills}
          palette={{ primary, secondary, accent }}
        />
        <InfoTabAnalysisGrid
          info={info}
          topMoods={topMoods}
          hasAnalysis={hasTrackAnalysis(info)}
          qualityPills={qualityPills}
        />
        <InfoTabReach info={info} />
        <InfoTabQuietMetrics info={info} />
      </div>
    </div>
  );
}
