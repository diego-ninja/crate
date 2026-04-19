/**
 * Shared EQ constants — single source of truth for the 10-band graphic
 * equalizer used by listen (player), admin (genre editor), and site (mock).
 */

export const EQ_BANDS = [
  { freq: 32, label: "32" },
  { freq: 64, label: "64" },
  { freq: 125, label: "125" },
  { freq: 250, label: "250" },
  { freq: 500, label: "500" },
  { freq: 1000, label: "1K" },
  { freq: 2000, label: "2K" },
  { freq: 4000, label: "4K" },
  { freq: 8000, label: "8K" },
  { freq: 16000, label: "16K" },
] as const;

export const EQ_BAND_COUNT = EQ_BANDS.length;
export const EQ_GAIN_MIN = -12;
export const EQ_GAIN_MAX = 12;
export const EQ_GAIN_RANGE = EQ_GAIN_MAX - EQ_GAIN_MIN;
export const EQ_GAIN_STEP = 0.5;

export type EqGains = readonly number[];

export const FLAT_GAINS: EqGains = Array.from({ length: EQ_BAND_COUNT }, () => 0);
