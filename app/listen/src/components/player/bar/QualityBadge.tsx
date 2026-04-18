import { Sparkles, Disc3, AudioLines } from "lucide-react";
import type { QualityBadge as QualityBadgeData } from "./player-bar-utils";

const tierStyles: Record<QualityBadgeData["tier"], { border: string; text: string; bg: string; glow?: string }> = {
  "hi-res": {
    border: "border-amber-400/50",
    text: "text-amber-300",
    bg: "bg-amber-400/10",
    glow: "shadow-[0_0_8px_rgba(251,191,36,0.15)]",
  },
  lossless: {
    border: "border-cyan-400/40",
    text: "text-cyan-300",
    bg: "bg-cyan-400/8",
  },
  high: {
    border: "border-primary/30",
    text: "text-primary/70",
    bg: "bg-transparent",
  },
  standard: {
    border: "border-white/15",
    text: "text-muted-foreground",
    bg: "bg-transparent",
  },
  low: {
    border: "border-white/10",
    text: "text-white/40",
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

export function QualityBadge({ badge }: { badge: QualityBadgeData }) {
  const style = tierStyles[badge.tier];
  const Icon = tierIcons[badge.tier];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-bold tracking-wider leading-none whitespace-nowrap border ${style.border} ${style.text} ${style.bg} ${style.glow || ""}`}
      title={badge.detail || badge.label}
    >
      {Icon && <Icon size={9} />}
      {badge.label}
    </span>
  );
}
