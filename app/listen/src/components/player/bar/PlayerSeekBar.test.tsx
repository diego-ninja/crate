import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlayerSeekBar } from "@/components/player/bar/PlayerSeekBar";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

describe("PlayerSeekBar", () => {
  it("localizes the seek control", () => {
    renderWithListenProviders(
      <PlayerSeekBar currentTime={30} duration={180} onSeek={vi.fn()} />,
      { locale: "es" },
    );

    expect(
      screen.getByRole("slider", { name: "Buscar posición de la canción" }),
    ).toBeVisible();
  });

  it("can be disabled while playback is controlled by a Jam room", () => {
    renderWithListenProviders(
      <PlayerSeekBar
        currentTime={30}
        duration={180}
        onSeek={vi.fn()}
        disabled
      />,
    );

    expect(screen.getByRole("slider")).toBeDisabled();
  });

  it("uses semantic tokens for the default progress track", () => {
    renderWithListenProviders(
      <PlayerSeekBar currentTime={30} duration={180} onSeek={vi.fn()} />,
    );

    const slider = screen.getByRole("slider");

    expect(slider.className).toContain("listen-player-seek-input");
    expect(slider.getAttribute("style")).toContain("--seek-progress");
    expect(slider.getAttribute("style")).not.toContain("rgba(");
  });

  it("uses semantic tokens for the glow presentation", () => {
    renderWithListenProviders(
      <PlayerSeekBar
        currentTime={30}
        duration={180}
        onSeek={vi.fn()}
        variant="glow"
        showTimes
      />,
    );

    const slider = screen.getByRole("slider");
    const progressTrack = slider.parentElement;

    expect(progressTrack?.className).toContain("listen-player-progress");
    expect(progressTrack?.innerHTML).not.toContain("rgba(");
  });
});
