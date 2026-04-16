import { EQ_BAND_COUNT, type EqGains } from "@/lib/equalizer";
import type { EqFeatures } from "@/hooks/use-eq-features";

/**
 * Translate the analysis-pipeline features of a track into a per-band
 * gain vector for the equalizer. Pure function, no state — same input
 * always produces the same gains.
 *
 * Philosophy: nudge, don't sculpt.
 *
 *   - Modern masterings are already over-EQ'd; we apply small corrections
 *     (usually ±2 dB, rarely ±3) rather than aggressive shapes.
 *   - When in doubt (high dynamic range, unknown loudness), return flat.
 *   - Signals are composable: each heuristic contributes additively so
 *     two weak signals don't dominate a single strong one.
 *
 * Bands (index-aligned):
 *   0:32  1:64  2:125  3:250  4:500  5:1K  6:2K  7:4K  8:8K  9:16K
 */

const FLAT: EqGains = new Array(EQ_BAND_COUNT).fill(0);

/**
 * Useful reference points extracted from typical analysis output:
 *
 *   brightness: [0, 1] where 1 = very bright (lots of high-freq energy)
 *     Anything < 0.30 is noticeably dark (e.g. classical chamber, doom).
 *     Anything > 0.65 feels harsh / sibilant territory.
 *
 *   loudness: LUFS. Streaming target ~-14. Modern loud masters sit around
 *     -8 to -10. Anything below -18 is dynamic / classical-friendly.
 *
 *   dynamicRange: crest-like dB. High (>14) = dynamic, don't mess with it.
 *     Low (<6) = heavily compressed, can tolerate (and sometimes benefit
 *     from) subtle contrast enhancement.
 *
 *   energy: [0, 1]. Broadband RMS-weighted intensity.
 *
 *   acousticness: [0, 1]. High = minimal electronic processing expected.
 */
export function computeAdaptiveGains(features: EqFeatures | null): EqGains {
  if (!features) return FLAT;

  const gains = new Array<number>(EQ_BAND_COUNT).fill(0);
  const add = (i: number, dB: number) => {
    gains[i]! += dB;
  };

  const { brightness, loudness, dynamicRange, energy, acousticness } = features;

  // Highly dynamic tracks: protect the artistic intent, bail out.
  if (typeof dynamicRange === "number" && dynamicRange > 14) {
    return FLAT;
  }

  // Brightness correction — tilt the upper shelf toward neutral.
  if (typeof brightness === "number") {
    if (brightness < 0.25) {
      // Dark track — lift air & presence so the mix opens up.
      add(7, 1.5);  // 4K
      add(8, 2);    // 8K
      add(9, 1.5);  // 16K
    } else if (brightness < 0.4) {
      add(8, 1);    // gentle 8K lift
    } else if (brightness > 0.7) {
      // Already sharp — tame before it gets fatiguing.
      add(7, -1.5); // 4K
      add(8, -2);   // 8K
    } else if (brightness > 0.55) {
      add(8, -1);
    }
  }

  // Energy shapes the low end feel.
  if (typeof energy === "number") {
    if (energy > 0.7) {
      // High-energy mix — reinforce kick punch without muddying.
      add(0, 1);    // 32  (sub weight)
      add(1, 1.5);  // 64  (kick body)
      add(4, -0.5); // 500 (keep mid clean)
    } else if (energy < 0.3) {
      // Mellow/ambient — gentle warmth in low-mids.
      add(3, 1);    // 250
    }
  }

  // Loudness correction — hot masters benefit from a touch of headroom
  // in the upper-mids where ear fatigue hides.
  if (typeof loudness === "number") {
    if (loudness > -10) {
      // Very loud master — subtle ear-saver.
      add(5, -0.5); // 1K
      add(6, -0.5); // 2K
    } else if (loudness < -20) {
      // Quiet / dynamic — small boost to parity.
      add(4, 0.5);  // 500
      add(5, 0.5);  // 1K
    }
  }

  // Dynamic range — compressed tracks can tolerate subtle V-shape.
  if (typeof dynamicRange === "number" && dynamicRange < 6) {
    add(1, 0.5); // 64
    add(8, 0.5); // 8K
  }

  // Acoustic material — warmth over sparkle.
  if (typeof acousticness === "number" && acousticness > 0.6) {
    add(3, 1);   // 250 (body of guitars/piano)
    add(7, -0.5); // 4K (ease the pick attack / transients)
  }

  // Clamp total per-band movement to ±4 dB so multiple heuristics
  // stacking can't produce wild curves.
  return gains.map((g) => Math.max(-4, Math.min(4, g)));
}
