import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/artwork/CrateImage", () => ({
  CrateImage: ({
    src,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img data-testid="authenticated-disc-artwork" src={src} {...props} />
  ),
}));

import { SpinningDisc } from "@/components/player/SpinningDisc";

const bounds = {
  bottom: 200,
  height: 200,
  left: 0,
  right: 200,
  top: 0,
  width: 200,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

function renderDisc(props: Partial<Parameters<typeof SpinningDisc>[0]> = {}) {
  const onSeek = vi.fn();
  const onTogglePlay = vi.fn();
  const onPlaybackRateChange = vi.fn();

  render(
    <SpinningDisc
      currentTime={30}
      duration={120}
      isPlaying={false}
      jogEnabled
      onPlaybackRateChange={onPlaybackRateChange}
      onSeek={onSeek}
      onTogglePlay={onTogglePlay}
      {...props}
    />,
  );

  const surface = screen.getByTestId("spinning-disc-jog-surface");
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(bounds);
  Object.assign(surface, {
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
    setPointerCapture: vi.fn(),
  });

  return { onPlaybackRateChange, onSeek, surface };
}

describe("SpinningDisc", () => {
  let now = 1000;

  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders album artwork through the authenticated media image", () => {
    renderDisc({ albumCover: "/api/albums/1/cover" });

    expect(screen.getByTestId("authenticated-disc-artwork")).toHaveAttribute(
      "src",
      "/api/albums/1/cover",
    );
  });

  it("uses semantic tokens for the disc surfaces and play control", () => {
    const { surface } = renderDisc();
    const playButton = screen.getByRole("button", { name: "Play" });
    const discContainer = surface.parentElement;

    expect(surface).toHaveClass("spinning-disc-surface");
    expect(discContainer?.querySelector(".spinning-disc-ambient")).toBeTruthy();
    expect(surface.querySelector(".spinning-disc-rotor")).toBeTruthy();
    expect(surface.querySelector(".spinning-disc-overlay")).toBeTruthy();
    expect(playButton).toHaveClass("spinning-disc-control");
    expect(
      playButton.querySelector(".spinning-disc-control-ring"),
    ).toBeTruthy();
    expect(surface.outerHTML).not.toContain("rgba(");
    expect(surface.outerHTML).not.toContain("border-white");
  });

  it("seeks while dragging in live jog mode", () => {
    const { onSeek, surface } = renderDisc({ jogSeekMode: "live" });

    fireEvent.pointerDown(surface, {
      button: 0,
      clientX: 200,
      clientY: 100,
      pointerId: 1,
      pointerType: "touch",
    });
    now = 1200;
    fireEvent.pointerMove(surface, {
      clientX: 100,
      clientY: 200,
      pointerId: 1,
      pointerType: "touch",
    });

    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  it("defers seek until release in commit jog mode", () => {
    const { onSeek, surface } = renderDisc({ jogSeekMode: "commit" });

    fireEvent.pointerDown(surface, {
      button: 0,
      clientX: 200,
      clientY: 100,
      pointerId: 1,
      pointerType: "touch",
    });
    now = 1200;
    fireEvent.pointerMove(surface, {
      clientX: 100,
      clientY: 200,
      pointerId: 1,
      pointerType: "touch",
    });

    expect(onSeek).not.toHaveBeenCalled();

    fireEvent.pointerUp(surface, {
      clientX: 100,
      clientY: 200,
      pointerId: 1,
      pointerType: "touch",
    });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(expect.any(Number));
  });
});
