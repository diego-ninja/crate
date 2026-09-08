import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SpectrumPlayButton } from "./SpectrumPlayButton";

describe("SpectrumPlayButton", () => {
  it("renders an accessible tokenized glow playback button", () => {
    const { container } = render(
      <SpectrumPlayButton aria-label="Play" size="lg">
        <span>Icon</span>
      </SpectrumPlayButton>,
    );

    const button = screen.getByRole("button", { name: "Play" });
    expect(button).toHaveClass("spectrum-play-button", "h-16");
    expect(
      container.querySelector(".spectrum-play-button-aura"),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".spectrum-play-button-rim"),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".spectrum-play-button-core"),
    ).toBeInTheDocument();
    expect(container.querySelector(".spectrum-play-button-icon")).toHaveClass(
      "text-text-primary",
    );
    expect(button.className).not.toContain("#");
    expect(button.innerHTML).not.toContain("rgba(");
  });

  it("forwards click handlers", () => {
    const onClick = vi.fn();
    render(
      <SpectrumPlayButton aria-label="Pause" onClick={onClick}>
        <span>Icon</span>
      </SpectrumPlayButton>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("adds organic pulse layers while active", () => {
    render(
      <SpectrumPlayButton aria-label="Pause" active>
        <span>Icon</span>
      </SpectrumPlayButton>,
    );

    const button = screen.getByRole("button", { name: "Pause" });
    expect(button).toHaveAttribute("data-active", "true");
    expect(button).toHaveClass("spectrum-play-button");
    expect(button.innerHTML).toContain("animate-crate-play-aura-pulse");
    expect(button.innerHTML).toContain("animate-crate-play-rim-pulse");
    expect(button.innerHTML).toContain("animate-crate-play-core-pulse");
  });
});
