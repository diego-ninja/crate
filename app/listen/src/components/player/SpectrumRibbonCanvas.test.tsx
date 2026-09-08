import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSpectrumRibbonBands,
  SPECTRUM_RIBBON_PERSISTENCE,
  SpectrumRibbonCanvas,
} from "./SpectrumRibbonCanvas";
import { SPECTRUM_RIBBON_COLOR_TOKENS } from "./visualizer-color-tokens";

describe("SpectrumRibbonCanvas", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses semantic tokens for spectrum stops", () => {
    expect(SPECTRUM_RIBBON_COLOR_TOKENS).toEqual([
      "--visualizer-ribbon-stop-0",
      "--visualizer-ribbon-stop-1",
      "--visualizer-ribbon-stop-2",
      "--visualizer-ribbon-stop-3",
      "--visualizer-ribbon-stop-4",
      "--visualizer-ribbon-stop-5",
      "--visualizer-ribbon-stop-6",
    ]);
  });

  it("keeps a slower phosphor decay while music is playing", () => {
    expect(SPECTRUM_RIBBON_PERSISTENCE.threadCount).toBeGreaterThan(20);
    expect(SPECTRUM_RIBBON_PERSISTENCE.playingDecayAlpha).toBeLessThan(
      SPECTRUM_RIBBON_PERSISTENCE.idleDecayAlpha,
    );
  });

  it("normalizes frequency bands for audio-reactive drawing", () => {
    const frequencies = Array.from({ length: 1024 }, () => -92);
    frequencies[3] = -18;
    frequencies[12] = -24;
    frequencies[40] = -30;

    const bands = buildSpectrumRibbonBands(frequencies, 44100);

    expect(bands.low).toBeGreaterThan(0.55);
    expect(bands.lowMid).toBeGreaterThan(0);
    expect(bands.mid).toBeGreaterThan(0);
    expect(bands.high).toBe(0);
  });

  it("renders a decorative canvas", () => {
    render(
      <div className="relative h-20 w-80">
        <SpectrumRibbonCanvas
          frequenciesDb={[]}
          waveform={[]}
          sampleRate={44100}
          isPlaying={false}
        />
      </div>,
    );

    const canvas = screen.getByTestId("spectrum-ribbon-canvas");
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas).toHaveClass("absolute");
    expect(canvas).toHaveClass("bg-transparent");
  });
});
