/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MusicPaths } from "./MusicPaths";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MusicPaths", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("switches paths and pauses playback", () => {
    render(<MusicPaths />);

    expect(screen.getByText("Don't Forget to Breathe")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /ambient.*black metal/i }),
    );
    expect(screen.getByText("An Ending")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Playing" }));
    expect(screen.getByRole("button", { name: "Paused" })).toBeTruthy();
  });
});
