/**
 * Extract dominant colors from an image URL using canvas sampling.
 * Returns 3 colors: primary, secondary, accent — each as [r, g, b] normalized 0-1.
 * Colors are boosted in saturation to look good as light sources.
 */

interface RGB { r: number; g: number; b: number }

export async function extractPalette(imageUrl: string): Promise<[[number, number, number], [number, number, number], [number, number, number]]> {
  const DEFAULT: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0.024, 0.714, 0.831],
    [0.4, 0.9, 1.0],
    [0.1, 0.3, 0.8],
  ];

  try {
    const img = await loadImage(imageUrl);
    const colors = sampleColors(img);
    if (colors.length < 3) return DEFAULT;

    // Boost saturation for vibrant glow
    return [
      normalize(boostSaturation(colors[0]!, 1.4)),
      normalize(boostSaturation(colors[1]!, 1.2)),
      normalize(boostSaturation(colors[2]!, 1.3)),
    ];
  } catch {
    return DEFAULT;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function sampleColors(img: HTMLImageElement): RGB[] {
  const size = 64; // downsample to 64x64
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;

  // Collect pixels into buckets using simple quantization
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;

    // Skip very dark and very light pixels
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    if (lum < 20 || lum > 240) continue;

    // Quantize to 4-bit per channel for grouping
    const qr = (r >> 4) << 4;
    const qg = (g >> 4) << 4;
    const qb = (b >> 4) << 4;
    const key = `${qr},${qg},${qb}`;

    const bucket = buckets.get(key);
    if (bucket) {
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count++;
    } else {
      buckets.set(key, { r, g, b, count: 1 });
    }
  }

  // Sort by frequency, take top colors that are distinct
  const sorted = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count);

  const result: RGB[] = [];
  for (const bucket of sorted) {
    const avg: RGB = {
      r: bucket.r / bucket.count,
      g: bucket.g / bucket.count,
      b: bucket.b / bucket.count,
    };

    // Skip if too similar to an existing color
    const tooSimilar = result.some(
      (c) => Math.abs(c.r - avg.r) + Math.abs(c.g - avg.g) + Math.abs(c.b - avg.b) < 80,
    );
    if (!tooSimilar) {
      result.push(avg);
      if (result.length >= 3) break;
    }
  }

  // Pad with defaults if not enough distinct colors
  while (result.length < 3) {
    result.push({ r: 6, g: 182, b: 212 }); // cyan fallback
  }

  return result;
}

function boostSaturation(color: RGB, factor: number): RGB {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  const mid = (max + min) / 2;

  return {
    r: Math.min(255, mid + (color.r - mid) * factor),
    g: Math.min(255, mid + (color.g - mid) * factor),
    b: Math.min(255, mid + (color.b - mid) * factor),
  };
}

function normalize(c: RGB): [number, number, number] {
  // Normalize to 0-1 and ensure minimum brightness for glow visibility
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const maxC = Math.max(r, g, b, 0.3); // ensure at least 0.3 brightness
  const scale = Math.max(r, g, b) > 0 ? maxC / Math.max(r, g, b) : 1;
  return [r * scale, g * scale, b * scale];
}
