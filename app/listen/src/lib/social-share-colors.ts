import { readCssColorToken } from "@crate/ui/lib/read-css-color";

export const SOCIAL_SHARE_COLOR_TOKENS = {
  darkSurface: "--surface-canvas",
  scrimMedium: "--scrim-hero-medium",
  scrimStrong: "--scrim-hero-strong",
  cardSurface: "--surface-contrast",
  cardInk: "--text-on-contrast",
  cardMutedInk: "--text-muted",
  generatedStart: "--surface-container",
  generatedMiddle: "--surface-elevated",
  accentGlow: "--accent-action-glow-medium",
  softText: "--surface-quiet-subtle",
  storyStart: "--surface-container",
  storyMiddle: "--surface-elevated",
  secondaryAccent: "--state-success-surface",
} as const;

export type SocialShareColors = {
  [Key in keyof typeof SOCIAL_SHARE_COLOR_TOKENS]: string;
};

export function readSocialShareColors(element: HTMLElement): SocialShareColors {
  const read = (key: keyof typeof SOCIAL_SHARE_COLOR_TOKENS): string =>
    readCssColorToken(element, SOCIAL_SHARE_COLOR_TOKENS[key]) ?? "transparent";

  return {
    darkSurface: read("darkSurface"),
    scrimMedium: read("scrimMedium"),
    scrimStrong: read("scrimStrong"),
    cardSurface: read("cardSurface"),
    cardInk: read("cardInk"),
    cardMutedInk: read("cardMutedInk"),
    generatedStart: read("generatedStart"),
    generatedMiddle: read("generatedMiddle"),
    accentGlow: read("accentGlow"),
    softText: read("softText"),
    storyStart: read("storyStart"),
    storyMiddle: read("storyMiddle"),
    secondaryAccent: read("secondaryAccent"),
  };
}
