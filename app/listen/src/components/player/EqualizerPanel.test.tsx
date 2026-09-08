import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const equalizerMock = vi.hoisted(() => ({
  useEqualizer: vi.fn(),
}));

vi.mock("@/hooks/use-equalizer", () => equalizerMock);

function makeEqualizerState(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    preset: "flat",
    gains: Array.from({ length: 10 }, () => 0),
    smart: false,
    adaptive: false,
    genreAdaptive: false,
    smartStatus: "idle",
    effectiveEq: null,
    adaptiveStatus: "idle",
    adaptiveFeatures: null,
    genreAdaptiveStatus: "idle",
    trackGenre: null,
    toggleEnabled: vi.fn(),
    toggleSmart: vi.fn(),
    toggleAdaptive: vi.fn(),
    toggleGenreAdaptive: vi.fn(),
    applyPreset: vi.fn(),
    updateBand: vi.fn(),
    resetToFlat: vi.fn(),
    saveForCurrentTrack: vi.fn(),
    clearCurrentTrackPreset: vi.fn(),
    ...overrides,
  };
}

describe("EqualizerPanel", () => {
  beforeEach(() => {
    equalizerMock.useEqualizer.mockReset();
    equalizerMock.useEqualizer.mockReturnValue(makeEqualizerState());
  });

  it("uses semantic tokens throughout the manual panel", () => {
    const { container } = renderWithListenProviders(
      <EqualizerPanel onClose={vi.fn()} />,
    );

    expect(
      screen.getByRole("heading", { name: "Equalizer" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close equalizer" })).toHaveClass(
      "text-text-muted",
    );
    expect(container.querySelector("svg")).toHaveClass("text-accent-action");
    expect(container.innerHTML).not.toContain("border-white");
    expect(container.innerHTML).not.toContain("text-white");
    expect(container.innerHTML).not.toContain("cyan-");
    expect(container.innerHTML).not.toContain("red-");
    expect(container.innerHTML).not.toContain("bg-black");
    expect(container.innerHTML).not.toContain("rgba(");
  });

  it("uses the accent-derived smart surface and danger token", () => {
    equalizerMock.useEqualizer.mockReturnValue(
      makeEqualizerState({
        smart: true,
        smartStatus: "ready",
        effectiveEq: {
          source: "user_track_preset",
          label: "Saved preset",
          reasoning: "Personal curve",
          genre: null,
          inheritedFrom: null,
        },
      }),
    );

    const { container } = renderWithListenProviders(<EqualizerPanel />);

    expect(container.querySelector(".eq-smart-surface")).toBeInTheDocument();
    expect(container.querySelector(".text-accent-action")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("cyan-");
    expect(container.innerHTML).not.toContain("red-");
  });
});
