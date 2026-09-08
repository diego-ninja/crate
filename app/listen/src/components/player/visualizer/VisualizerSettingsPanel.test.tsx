import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VisualizerSettingsPanel } from "./VisualizerSettingsPanel";
import type { VisualizerConfigState } from "./useVisualizerConfig";

function makeConfig(
  overrides: Partial<VisualizerConfigState> = {},
): VisualizerConfigState {
  return {
    surfaceMode: "visualizer",
    vizEnabled: true,
    useAlbumPalette: true,
    trackAdaptiveViz: false,
    vizConfig: {
      separation: 0.15,
      glow: 6,
      scale: 1.4,
      persistence: 0.8,
      octaves: 2,
    },
    effectiveVizConfig: {
      separation: 0.15,
      glow: 6,
      scale: 1.4,
      persistence: 0.8,
      octaves: 2,
    },
    trackVizProfile: {
      moodTag: null,
      hasAnalysis: false,
      summary: null,
      settingsDelta: {
        separation: 0,
        glow: 0,
        scale: 0,
        persistence: 0,
        octaves: 0,
      },
      motion: {
        orbitSpeed: 1,
        cameraDrift: 1,
        cameraDepth: 0,
        pulseGain: 1,
        turbulence: 1,
        orbitPhase: 0,
        shellDensity: 1,
        beatResponse: 1,
        beatDecay: 0.88,
        sectionRate: 1,
        sectionDepth: 0.12,
        lowBandWeight: 1,
        midBandWeight: 1,
        highBandWeight: 1,
      },
      paletteBias: {
        brightness: 0,
        coolness: 0,
        saturation: 0,
        hueShift: 0,
      },
    },
    setSurfaceMode: vi.fn(),
    toggleAlbumPalette: vi.fn(),
    toggleTrackAdaptive: vi.fn(),
    updateConfig: vi.fn(),
    resetConfig: vi.fn(),
    ...overrides,
  };
}

describe("VisualizerSettingsPanel", () => {
  it("uses semantic tokens for toggles, status, and sliders", () => {
    const { container } = render(
      <VisualizerSettingsPanel config={makeConfig()} />,
    );

    expect(screen.getByText("Visualizer settings")).toBeInTheDocument();
    expect(container.querySelector(".bg-accent-action")).toBeInTheDocument();
    expect(container.querySelector(".bg-text-primary")).toBeInTheDocument();
    expect(container.querySelector(".border-border-quiet")).toBeInTheDocument();
    expect(container.querySelector(".text-text-muted")).toBeInTheDocument();
    expect(container.querySelector("input[type='range']")).toHaveClass(
      "accent-accent-action",
    );
    expect(container.innerHTML).not.toContain("bg-primary");
    expect(container.innerHTML).not.toContain("bg-white");
    expect(container.innerHTML).not.toContain("text-white/");
  });

  it("keeps the disabled visualizer state on semantic control tokens", () => {
    const { container } = render(
      <VisualizerSettingsPanel
        config={makeConfig({ vizEnabled: false, surfaceMode: "cover" })}
      />,
    );

    expect(
      container.querySelector(".bg-border-interactive"),
    ).toBeInTheDocument();
    expect(container.querySelector(".bg-text-primary")).toBeInTheDocument();
    expect(container.querySelector("input[type='range']")).toBeDisabled();
    expect(container.innerHTML).not.toContain("bg-white");
  });
});
