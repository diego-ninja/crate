import { Sun, Tag } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { getAdaptiveFeatureChipData } from "./equalizer-adaptive-feature-data";
import type { EqFeatures } from "@/hooks/use-eq-features";
import type { TrackGenre } from "@/hooks/use-track-genre";
import { CrateChip } from "@crate/ui/primitives/CrateBadge";

function FeatureChip({
  icon: Icon,
  label,
  value,
  zone,
}: {
  icon: typeof Sun;
  label: string;
  value: string;
  zone: "neutral" | "active";
}) {
  return (
    <CrateChip
      active={zone === "active"}
      icon={Icon}
      className="font-mono tabular-nums"
    >
      <span title={label}>{value}</span>
    </CrateChip>
  );
}

export function AdaptiveFeatureChips({
  features,
  status,
}: {
  features: EqFeatures | null;
  status: "idle" | "loading" | "ready" | "unavailable";
}) {
  const { t } = useTranslation();
  if (status === "loading") {
    return (
      <div className="rounded-md border border-border-quiet bg-surface-control px-2.5 py-1.5 text-xs text-text-muted">
        {t("player.equalizer.adaptive.loading")}
      </div>
    );
  }
  if (status === "unavailable" || !features) {
    return (
      <div className="rounded-md border border-border-quiet bg-surface-control px-2.5 py-1.5 text-xs text-text-muted">
        {t("player.equalizer.adaptive.unavailable")}
      </div>
    );
  }

  const chips = getAdaptiveFeatureChipData(features);
  if (chips.length === 0) {
    return (
      <div className="rounded-md border border-border-quiet bg-surface-control px-2.5 py-1.5 text-xs text-text-muted">
        {t("player.equalizer.adaptive.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs uppercase tracking-wider text-text-subtle">
        {t("player.equalizer.track")}
      </span>
      {chips.map(({ key, ...chip }) => (
        <FeatureChip key={key} {...chip} />
      ))}
    </div>
  );
}

export function GenreResolutionChip({
  genre,
  status,
}: {
  genre: TrackGenre | null;
  status: "idle" | "loading" | "ready" | "unavailable";
}) {
  const { t } = useTranslation();
  if (status === "loading") {
    return (
      <div className="rounded-md border border-border-quiet bg-surface-control px-2.5 py-1.5 text-xs text-text-muted">
        {t("player.equalizer.genre.loading")}
      </div>
    );
  }
  if (status === "unavailable" || !genre?.primary) {
    return (
      <div className="rounded-md border border-border-quiet bg-surface-control px-2.5 py-1.5 text-xs text-text-muted">
        {t("player.equalizer.genre.unavailable")}
      </div>
    );
  }

  const primaryName = genre.primary.name;
  const canonical = genre.primary.canonical;
  const preset = genre.preset;

  if (!canonical) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-quiet bg-surface-control px-2.5 py-1.5 text-xs text-text-secondary">
        <Tag size={10} className="opacity-70" />
        <span className="font-medium capitalize text-text-primary/80">
          {primaryName}
        </span>
        <span className="opacity-50">
          {t("player.equalizer.genre.unmapped")}
        </span>
      </div>
    );
  }

  if (!preset) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-quiet bg-surface-control px-2.5 py-1.5 text-xs text-text-secondary">
        <Tag size={10} className="opacity-70" />
        <span className="font-medium capitalize text-text-primary/80">
          {primaryName}
        </span>
        <span className="opacity-50">
          {t("player.equalizer.genre.noPreset")}
        </span>
      </div>
    );
  }

  const isInherited = preset.source === "inherited";
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-accent-action/30 bg-accent-action/10 px-2.5 py-1.5 text-xs text-accent-action">
      <Tag size={10} />
      <span className="font-medium capitalize">{primaryName}</span>
      <span className="opacity-70">
        {isInherited
          ? t("player.equalizer.genre.inherited")
          : t("player.equalizer.genre.preset")}
      </span>
      {isInherited && preset.inheritedFrom ? (
        <span className="font-medium capitalize opacity-80">
          {t("player.equalizer.genre.from", {
            name: preset.inheritedFrom.name,
          })}
        </span>
      ) : null}
    </div>
  );
}
