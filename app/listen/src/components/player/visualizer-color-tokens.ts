export const SPECTRUM_RIBBON_COLOR_TOKENS = [
  "--visualizer-ribbon-stop-0",
  "--visualizer-ribbon-stop-1",
  "--visualizer-ribbon-stop-2",
  "--visualizer-ribbon-stop-3",
  "--visualizer-ribbon-stop-4",
  "--visualizer-ribbon-stop-5",
  "--visualizer-ribbon-stop-6",
] as const;

export const WAVEFORM_COLOR_TOKENS = {
  activeGradientBottom: "--surface-accent-subtle",
  activeGradientTop: "--visualizer-ribbon-stop-1",
  idleGradientBottom: "--surface-accent-shadow",
  idleGradientTop: "--border-accent",
  peakActive: "--visualizer-waveform-peak-active",
  peakIdle: "--accent-action-strong",
} as const;
