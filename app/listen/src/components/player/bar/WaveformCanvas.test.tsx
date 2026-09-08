import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WaveformCanvas } from "./WaveformCanvas";

describe("WaveformCanvas", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a canvas for semantic waveform rendering", () => {
    const { container } = render(
      <WaveformCanvas
        frequenciesDb={[]}
        sampleRate={44100}
        isPlaying={false}
      />,
    );

    expect(container.querySelector("canvas")).toBeInTheDocument();
  });
});
