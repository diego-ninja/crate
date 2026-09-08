import type { VisualizerColorTriplet } from "@/components/player/visualizer/visualizer-colors";

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rgbToHsl([r, g, b]: VisualizerColorTriplet): VisualizerColorTriplet {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;
  switch (max) {
    case r:
      hue = (g - b) / delta + (g < b ? 6 : 0);
      break;
    case g:
      hue = (b - r) / delta + 2;
      break;
    default:
      hue = (r - g) / delta + 4;
      break;
  }
  return [hue / 6, saturation, lightness];
}

function hueToRgb(p: number, q: number, t: number) {
  let color = t;
  if (color < 0) color += 1;
  if (color > 1) color -= 1;
  if (color < 1 / 6) return p + (q - p) * 6 * color;
  if (color < 1 / 2) return q;
  if (color < 2 / 3) return p + (q - p) * (2 / 3 - color) * 6;
  return p;
}

function hslToRgb([h, s, l]: VisualizerColorTriplet): VisualizerColorTriplet {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hueToRgb(p, q, h + 1 / 3),
    hueToRgb(p, q, h),
    hueToRgb(p, q, h - 1 / 3),
  ];
}

export function adjustPaletteColor(
  [r, g, b]: VisualizerColorTriplet,
  brightness: number,
  coolness: number,
  saturation: number,
  hueShift: number,
): VisualizerColorTriplet {
  const average = (r + g + b) / 3;
  const saturationScale = 1 + saturation;
  const sr = average + (r - average) * saturationScale;
  const sg = average + (g - average) * saturationScale;
  const sb = average + (b - average) * saturationScale;
  const [h, s, l] = rgbToHsl([
    clamp(sr + brightness - coolness * 0.4, 0, 1),
    clamp(sg + brightness * 0.8 - coolness * 0.05, 0, 1),
    clamp(sb + brightness * 0.45 + coolness, 0, 1),
  ]);
  return hslToRgb([
    (h + hueShift + 1) % 1,
    clamp(s + Math.abs(hueShift) * 0.12, 0, 1),
    l,
  ]);
}
