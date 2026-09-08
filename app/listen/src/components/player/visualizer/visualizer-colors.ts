import { readCanvasColorToken } from "@/lib/canvas-color";

export type VisualizerColorTriplet = [number, number, number];
export type VisualizerColorPalette = [
  VisualizerColorTriplet,
  VisualizerColorTriplet,
  VisualizerColorTriplet,
];

export const DEFAULT_VISUALIZER_COLORS: VisualizerColorPalette = [
  [0.024, 0.714, 0.831],
  [0.4, 0.9, 1],
  [0.1, 0.3, 0.8],
];

export const VISUALIZER_COLOR_TOKENS = {
  color1: "--accent-action",
  color2: "--visualizer-sphere-color-2",
  color3: "--visualizer-sphere-color-3",
} as const;

function parseColorChannel(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const percentage = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percentage) ? clamp(percentage / 100) : null;
  }

  const channel = Number.parseFloat(trimmed);
  if (!Number.isFinite(channel)) return null;
  return clamp(channel > 1 ? channel / 255 : channel);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function parseVisualizerColor(
  value: string,
): VisualizerColorTriplet | null {
  const match = value
    .trim()
    .match(/^(?:rgba?\((.*)\)|color\(\s*srgb\s+(.+)\))$/i);
  if (!match) return null;

  const channelText = match[1] ?? match[2];
  if (!channelText) return null;

  const channels: Array<number | null> = (channelText.split("/")[0] ?? "")
    .replace(/,/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map(parseColorChannel);
  if (channels.length !== 3 || channels.some((channel) => channel === null)) {
    return null;
  }

  return channels as VisualizerColorTriplet;
}

export function readVisualizerColors(
  element: HTMLElement,
): VisualizerColorPalette {
  const read = (
    key: keyof typeof VISUALIZER_COLOR_TOKENS,
    index: number,
  ): VisualizerColorTriplet => {
    const parsed = parseVisualizerColor(
      readCanvasColorToken(element, VISUALIZER_COLOR_TOKENS[key]) ?? "",
    );
    if (parsed) return parsed;
    return [
      ...(DEFAULT_VISUALIZER_COLORS[index] ?? DEFAULT_VISUALIZER_COLORS[0]),
    ];
  };

  return [read("color1", 0), read("color2", 1), read("color3", 2)];
}
