import { Sparkles, Disc3, AudioLines } from "@crate/ui/icons";
import type { QualityBadge as QualityBadgeData } from "./player-bar-utils";

const tierStyles: Record<
  QualityBadgeData["tier"],
  { border: string; text: string; bg: string; glow?: string }
> = {
  "hi-res": {
    border: "border-state-warning/50",
    text: "text-state-warning",
    bg: "bg-state-warning/10",
    glow: "quality-badge-hi-res-glow",
  },
  lossless: {
    border: "border-state-info/40",
    text: "text-state-info",
    bg: "bg-state-info/8",
  },
  high: {
    border: "border-accent-action/30",
    text: "text-accent-action/70",
    bg: "bg-transparent",
  },
  standard: {
    border: "border-border-quiet",
    text: "text-text-muted",
    bg: "bg-transparent",
  },
  low: {
    border: "border-border-quiet",
    text: "text-text-subtle",
    bg: "bg-transparent",
  },
};

const tierIcons: Record<QualityBadgeData["tier"], typeof Sparkles | null> = {
  "hi-res": Sparkles,
  lossless: AudioLines,
  high: Disc3,
  standard: null,
  low: null,
};

type QualityBadgeOrigin = "source" | "stream";

export function QualityBadge({
  badge,
  origin = "source",
}: {
  badge: QualityBadgeData;
  origin?: QualityBadgeOrigin;
}) {
  const style = tierStyles[badge.tier];
  const Icon = origin === "source" ? tierIcons[badge.tier] : null;
  const variantClass =
    origin === "stream"
      ? "quality-badge-stream"
      : `${style.border} ${style.text} ${style.bg} ${style.glow || ""}`;
  const title =
    origin === "stream"
      ? `Streaming delivery quality · ${badge.detail || badge.label}`
      : badge.detail || badge.label;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold tracking-wider leading-none whitespace-nowrap border ${variantClass}`}
      title={title}
    >
      {Icon && <Icon size={9} />}
      {badge.label}
    </span>
  );
}
