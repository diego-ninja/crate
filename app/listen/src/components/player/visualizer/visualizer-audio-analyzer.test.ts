import { describe, expect, it } from "vitest";
import { VisualizerAudioAnalyzer } from "./visualizer-audio-analyzer";

function createAnalyser(frequency = 128, time = 128): AnalyserNode {
  return {
    frequencyBinCount: 32,
    fftSize: 64,
    getByteFrequencyData(data: Uint8Array<ArrayBuffer>) {
      data.fill(frequency);
    },
    getByteTimeDomainData(data: Uint8Array<ArrayBuffer>) {
      data.fill(time);
    },
  } as unknown as AnalyserNode;
}

describe("VisualizerAudioAnalyzer", () => {
  it("normalizes a live signal into finite metrics", () => {
    const analyzer = new VisualizerAudioAnalyzer(
      createAnalyser(180, 128),
      () => ({ volume: 0.5, isPlaying: true }),
    );

    const metrics = analyzer.read({
      time: 0,
      beatResponse: 1,
      beatDecay: 0.88,
    });

    expect(Object.values(metrics).every(Number.isFinite)).toBe(true);
    expect(metrics.timeAvg).toBeCloseTo(128 / 255, 5);
    expect(metrics.low).toBeGreaterThan(0);
    expect(metrics.mid).toBeGreaterThan(0);
    expect(metrics.high).toBeGreaterThan(0);
  });

  it("fades the analysis level when playback is paused", () => {
    const analyzer = new VisualizerAudioAnalyzer(
      createAnalyser(220, 128),
      () => ({ volume: 1, isPlaying: false }),
    );

    const metrics = analyzer.read({
      time: 0,
      beatResponse: 1,
      beatDecay: 0.88,
    });

    expect(metrics.low).toBeGreaterThan(0);
    expect(metrics.low).toBeLessThan(1.25);
  });

  it("decays track-arrival accents on the next analysis frame", () => {
    const analyzer = new VisualizerAudioAnalyzer(
      createAnalyser(128, 128),
      () => ({ volume: 0.5, isPlaying: true }),
    );

    analyzer.accentTrackChange(2);
    expect(analyzer.arrivalAccentPulse).toBe(1.5);

    analyzer.read({ time: 0, beatResponse: 1, beatDecay: 0.88 });

    expect(analyzer.arrivalAccentPulse).toBeLessThan(1.5);
    expect(analyzer.arrivalAccentPulse).toBeGreaterThan(0);
  });
});
