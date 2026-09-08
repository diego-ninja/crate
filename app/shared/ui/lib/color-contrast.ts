interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

interface ParsedColor extends RgbColor {
  alpha: number;
}

export const DEFAULT_DARK_FOREGROUND = "#0a0a0f";
export const DEFAULT_LIGHT_FOREGROUND = "#ffffff";

export function parseHexColor(value: string): RgbColor | null {
  const normalized = value.trim().replace(/^#/, "");
  if (![3, 6].includes(normalized.length) || !/^[\da-f]+$/i.test(normalized)) {
    return null;
  }

  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((channel) => `${channel}${channel}`)
          .join("")
      : normalized;
  const channels = expanded.match(/[\da-f]{2}/gi);
  if (!channels || channels.length !== 3) return null;

  return {
    red: Number.parseInt(channels[0]!, 16),
    green: Number.parseInt(channels[1]!, 16),
    blue: Number.parseInt(channels[2]!, 16),
  };
}

function parseColorChannel(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const percentage = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percentage)
      ? Math.round((Math.max(0, Math.min(100, percentage)) / 100) * 255)
      : null;
  }

  const channel = Number.parseFloat(trimmed);
  return Number.isFinite(channel)
    ? Math.round(Math.max(0, Math.min(255, channel)))
    : null;
}

function parseAlphaChannel(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const percentage = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percentage)
      ? Math.max(0, Math.min(100, percentage)) / 100
      : null;
  }

  const alpha = Number.parseFloat(trimmed);
  return Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : null;
}

/**
 * Parses the small CSS color subset used by token contracts. Unsupported
 * expressions such as color-mix() intentionally return null: a static check
 * must not invent a background and report false WCAG confidence.
 */
export function parseCssColor(value: string): ParsedColor | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "transparent") {
    return { red: 0, green: 0, blue: 0, alpha: 0 };
  }

  const hex = normalized.replace(/^#/, "");
  if (/^[\da-f]{3}$|^[\da-f]{6}$/i.test(hex)) {
    const rgb = parseHexColor(hex);
    return rgb ? { ...rgb, alpha: 1 } : null;
  }

  if (/^[\da-f]{4}$|^[\da-f]{8}$/i.test(hex)) {
    const expanded =
      hex.length === 4
        ? hex
            .split("")
            .map((channel) => `${channel}${channel}`)
            .join("")
        : hex;
    const channels = expanded.match(/[\da-f]{2}/gi);
    if (!channels || channels.length !== 4) return null;

    return {
      red: Number.parseInt(channels[0]!, 16),
      green: Number.parseInt(channels[1]!, 16),
      blue: Number.parseInt(channels[2]!, 16),
      alpha: Number.parseInt(channels[3]!, 16) / 255,
    };
  }

  const rgbMatch = normalized.match(/^rgba?\((.*)\)$/);
  if (!rgbMatch) return null;

  const channels = rgbMatch[1]!.includes(",")
    ? rgbMatch[1]!.split(",").map((channel) => channel.trim())
    : rgbMatch[1]!.split(/\s*\/\s*|\s+/).filter(Boolean);
  if (channels.length !== 3 && channels.length !== 4) return null;

  const parsedChannels = channels.slice(0, 3).map(parseColorChannel);
  const red = parsedChannels[0] ?? null;
  const green = parsedChannels[1] ?? null;
  const blue = parsedChannels[2] ?? null;
  const alpha = channels.length === 4 ? parseAlphaChannel(channels[3]!) : 1;
  if (red === null || green === null || blue === null || alpha === null) {
    return null;
  }

  return { red, green, blue, alpha };
}

function compositeColor(
  foreground: ParsedColor,
  background: ParsedColor,
): ParsedColor {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };

  return {
    red: Math.round(
      (foreground.red * foreground.alpha +
        background.red * background.alpha * (1 - foreground.alpha)) /
        alpha,
    ),
    green: Math.round(
      (foreground.green * foreground.alpha +
        background.green * background.alpha * (1 - foreground.alpha)) /
        alpha,
    ),
    blue: Math.round(
      (foreground.blue * foreground.alpha +
        background.blue * background.alpha * (1 - foreground.alpha)) /
        alpha,
    ),
    alpha,
  };
}

function relativeLuminance(color: RgbColor): number {
  const channels = [color.red, color.green, color.blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatioForRgb(
  foreground: RgbColor,
  background: RgbColor,
): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastRatio(
  foreground: string,
  background: string,
): number | null {
  const foregroundColor = parseHexColor(foreground);
  const backgroundColor = parseHexColor(background);
  if (!foregroundColor || !backgroundColor) return null;

  const foregroundLuminance = relativeLuminance(foregroundColor);
  const backgroundLuminance = relativeLuminance(backgroundColor);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Computes contrast after alpha compositing. A backdrop is required when the
 * background itself is translucent, which is the case for artwork/glass
 * surfaces whose final color depends on the content underneath.
 */
export function contrastRatioComposited(
  foreground: string,
  background: string,
  backdrop?: string,
): number | null {
  const foregroundColor = parseCssColor(foreground);
  const backgroundColor = parseCssColor(background);
  if (!foregroundColor || !backgroundColor) return null;

  let renderedBackground = backgroundColor;
  if (backgroundColor.alpha < 1) {
    if (!backdrop) return null;
    const backdropColor = parseCssColor(backdrop);
    if (!backdropColor || backdropColor.alpha < 1) return null;
    renderedBackground = compositeColor(backgroundColor, backdropColor);
  }

  const renderedForeground = compositeColor(
    foregroundColor,
    renderedBackground,
  );
  return contrastRatioForRgb(renderedForeground, renderedBackground);
}

export function chooseAccessibleForeground(
  background: string,
  candidates: readonly string[] = [
    DEFAULT_DARK_FOREGROUND,
    DEFAULT_LIGHT_FOREGROUND,
  ],
): string | null {
  let strongest: { color: string; ratio: number } | null = null;

  for (const candidate of candidates) {
    const ratio = contrastRatioComposited(candidate, background);
    if (ratio === null) continue;
    if (!strongest || ratio > strongest.ratio) {
      strongest = { color: candidate, ratio };
    }
  }

  return strongest?.color ?? null;
}

export function meetsWcagAa(
  foreground: string,
  background: string,
  largeText = false,
): boolean {
  const ratio = contrastRatio(foreground, background);
  return ratio !== null && ratio >= (largeText ? 3 : 4.5);
}
