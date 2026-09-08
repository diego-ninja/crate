import { Activity, Sun, Volume2, Zap } from "@crate/ui/icons";

import type { EqFeatures } from "@/hooks/use-eq-features";

export type AdaptiveFeatureChipData = {
  key: string;
  icon: typeof Sun;
  label: string;
  value: string;
  zone: "neutral" | "active";
};

export function getAdaptiveFeatureChipData(
  features: EqFeatures,
): AdaptiveFeatureChipData[] {
  const chips: AdaptiveFeatureChipData[] = [];

  if (typeof features.brightness === "number") {
    const brightness = features.brightness;
    const label =
      brightness < 0.25
        ? "dark"
        : brightness < 0.4
          ? "warm"
          : brightness > 0.7
            ? "sharp"
            : brightness > 0.55
              ? "bright"
              : "neutral";
    chips.push({
      key: "brightness",
      icon: Sun,
      label: `Brightness: ${label}`,
      value: `${Math.round(brightness * 100)}%`,
      zone: brightness < 0.4 || brightness > 0.55 ? "active" : "neutral",
    });
  }

  if (typeof features.loudness === "number") {
    const loudness = features.loudness;
    chips.push({
      key: "loudness",
      icon: Volume2,
      label:
        loudness > -10
          ? "Hot master"
          : loudness < -20
            ? "Very quiet"
            : "Standard level",
      value: `${loudness.toFixed(1)} LUFS`,
      zone: loudness > -10 || loudness < -20 ? "active" : "neutral",
    });
  }

  if (typeof features.dynamicRange === "number") {
    const dynamicRange = features.dynamicRange;
    const label =
      dynamicRange > 14
        ? "preserved"
        : dynamicRange < 6
          ? "compressed"
          : "moderate";
    chips.push({
      key: "dynamic",
      icon: Activity,
      label: `Dynamic range: ${label}`,
      value: `${dynamicRange.toFixed(1)} dB`,
      zone: dynamicRange > 14 || dynamicRange < 6 ? "active" : "neutral",
    });
  }

  if (typeof features.energy === "number") {
    const energy = features.energy;
    chips.push({
      key: "energy",
      icon: Zap,
      label:
        energy > 0.7
          ? "High energy"
          : energy < 0.3
            ? "Low energy"
            : "Moderate energy",
      value: `${Math.round(energy * 100)}%`,
      zone: energy > 0.7 || energy < 0.3 ? "active" : "neutral",
    });
  }

  return chips;
}
