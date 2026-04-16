/**
 * 10-band graphic equalizer built on Web Audio BiquadFilterNodes.
 *
 * Every filter is `peaking` type (center frequency boosted/cut without
 * affecting neighbours). Filters chain in series so gains are additive.
 *
 * The chain is completely owned by the caller — no global state, no
 * hidden side effects. Use `createEqChain(ctx)` to build one, then hand
 * its `input` / `output` nodes to the Gapless-5 player's
 * `setOutputChain(input, output)` method.
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

/**
 * Gains in dB, index-aligned with EQ_BANDS. Values are clamped to the
 * [EQ_GAIN_MIN, EQ_GAIN_MAX] range at apply time.
 */
export type EqGains = readonly number[];

/**
 * EQ presets. Values are in dB per band, index-aligned with EQ_BANDS
 * (32 / 64 / 125 / 250 / 500 / 1K / 2K / 4K / 8K / 16K Hz).
 *
 * Heavy-genre presets are tuned to the mixing conventions of each
 * style — they're not just generic "metal" shapes. Comments above each
 * entry describe the intent so anyone can tune them later.
 */
export const EQ_PRESETS: Record<string, EqGains> = {
  flat:        [ 0,  0,  0,  0,  0,  0,  0,  0,  0,  0],

  // ── General-purpose ─────────────────────────────────────────────
  rock:        [ 4,  3, -1, -3, -2,  1,  3,  5,  5,  5],
  pop:         [-1,  2,  4,  4,  2, -1, -1, -1, -1, -1],
  jazz:        [ 3,  2,  1,  2, -1, -1,  0,  1,  2,  3],
  classical:   [ 4,  3,  2,  1, -1, -1,  0,  2,  3,  4],
  bass_boost:  [ 7,  6,  4,  2,  0, -1, -2, -2, -2, -2],
  treble_boost:[-2, -2, -2, -1,  0,  1,  3,  5,  6,  7],
  vocal:       [-2, -3, -3,  1,  4,  4,  3,  1,  0, -1],
  electronic:  [ 5,  4,  1, -1, -2,  1,  0,  1,  4,  5],
  acoustic:    [ 4,  3,  2,  1,  2,  2,  3,  3,  2,  1],

  // ── Underground / heavy genres ──────────────────────────────────

  // Black metal: tremolo picking presence (4–8k), scooped 500–1k,
  // blast-beat body at 60–125, tame the sub (production usually lo-fi).
  black_metal: [-1,  3,  4,  1, -3, -2,  3,  6,  6,  4],

  // Death metal: kick + guitar low-end body (80–250), classic scoop at
  // 500, pick-attack + double-bass articulation at 2–4k, tight extremes.
  death_metal: [ 2,  5,  6,  4, -3, -2,  4,  5,  2,  0],

  // Thrash: aggressive V-shape — big chugs, scooped mids, bright cymbals.
  thrash:      [ 3,  5,  4,  0, -4, -3,  2,  5,  6,  5],

  // Doom / sludge: massive low-end, recessed upper mids, dark top.
  doom:        [ 6,  6,  5,  3,  0, -2, -3, -3, -2, -1],

  // Hardcore / metalcore: breakdowns need bass, screamed vocals at 3k,
  // crunchy guitars at 1.5–2k.
  hardcore:    [ 4,  4,  2, -1,  1,  3,  5,  4,  2,  1],

  // Punk: upfront mids, raw. Guitar bite at 1–3k, modest low-end,
  // slight roll-off on top to keep it grimy.
  punk:        [ 2,  3,  1, -1,  2,  4,  4,  3,  1, -1],

  // Progressive rock / metal: balanced, wide-open, preserves detail.
  progressive: [ 2,  2,  1,  0,  0,  0,  1,  2,  3,  3],

  // Shoegaze: mid-forward wall-of-sound, dense, not much extreme action.
  shoegaze:    [ 1,  2,  3,  3,  4,  3,  2,  1,  0,  0],

  // Post-rock: dynamic, spacious, just a subtle shape.
  post_rock:   [ 2,  2,  2,  1,  0,  0,  1,  2,  3,  3],

  // Indie / lo-fi: warmth without losing character, very subtle.
  lo_fi:       [ 1,  2,  2,  1,  1,  0,  0,  1,  2,  1],

  // Hip-hop: 808 sub weight + crisp kick punch + vocal clarity.
  hip_hop:     [ 6,  5,  3,  1,  0,  1,  2,  3,  3,  2],
};

export type EqPresetName = keyof typeof EQ_PRESETS;

export interface EqChain {
  /** First filter in the chain — connect your source here. */
  input: AudioNode;
  /** Last filter in the chain — connect this to your destination. */
  output: AudioNode;
  /** Update the gain of a single band (0..EQ_BAND_COUNT-1). */
  setGain: (bandIndex: number, dB: number) => void;
  /** Update all bands at once (array must have EQ_BAND_COUNT entries). */
  setGains: (gains: EqGains) => void;
  /**
   * Read the current gains in dB, freshly pulled from the filter nodes.
   * Useful for "save current state" flows.
   */
  readGains: () => number[];
  /** Disconnect every filter. Call before dropping the reference. */
  dispose: () => void;
}

function clampGain(dB: number): number {
  if (!Number.isFinite(dB)) return 0;
  return Math.max(EQ_GAIN_MIN, Math.min(EQ_GAIN_MAX, dB));
}

/**
 * Build a 10-band peaking equalizer chain.
 *
 * Initial gains default to flat (0 dB). Use setGains() to apply a preset
 * right after construction.
 */
export function createEqChain(ctx: AudioContext): EqChain {
  const filters: BiquadFilterNode[] = EQ_BANDS.map(({ freq }) => {
    const filter = ctx.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.value = freq;
    // Q ~= 1.41 gives roughly one octave bandwidth per band — matches
    // how most graphic EQs feel. Higher Q = narrower, more surgical.
    filter.Q.value = 1.41;
    filter.gain.value = 0;
    return filter;
  });

  // Chain: f0 → f1 → f2 → ... → fN
  for (let i = 0; i < filters.length - 1; i++) {
    filters[i]!.connect(filters[i + 1]!);
  }

  return {
    input: filters[0]!,
    output: filters[filters.length - 1]!,
    setGain: (bandIndex, dB) => {
      const filter = filters[bandIndex];
      if (!filter) return;
      filter.gain.value = clampGain(dB);
    },
    setGains: (gains) => {
      for (let i = 0; i < filters.length; i++) {
        filters[i]!.gain.value = clampGain(gains[i] ?? 0);
      }
    },
    readGains: () => filters.map((f) => f.gain.value),
    dispose: () => {
      for (const f of filters) {
        try { f.disconnect(); } catch { /* ignore */ }
      }
    },
  };
}

/**
 * Returns true iff every gain in the array is effectively 0 dB.
 * Used to short-circuit applying a "flat" chain (= no chain at all).
 */
export function isFlatGains(gains: EqGains): boolean {
  return gains.every((g) => Math.abs(g) < 0.01);
}
