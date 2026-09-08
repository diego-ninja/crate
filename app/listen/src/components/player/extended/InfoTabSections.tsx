import type { TrackInfo } from "@/lib/track-info";

import { InfoTabAudioProfile } from "./InfoTabAudioProfile";
import { InfoTabBliss } from "./InfoTabBliss";
import { InfoTabMood } from "./InfoTabMood";
import { InfoTabSource } from "./InfoTabSource";
import type { MoodEntry } from "./info-tab-data";

export function InfoTabAnalysisGrid({
  info,
  topMoods,
  hasAnalysis,
  qualityPills,
}: {
  info: TrackInfo;
  topMoods: MoodEntry[];
  hasAnalysis: boolean;
  qualityPills: string[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <InfoTabAudioProfile hasAnalysis={hasAnalysis} info={info} />
      <InfoTabMood info={info} topMoods={topMoods} />
      <InfoTabBliss info={info} />
      <InfoTabSource info={info} qualityPills={qualityPills} />
    </div>
  );
}
