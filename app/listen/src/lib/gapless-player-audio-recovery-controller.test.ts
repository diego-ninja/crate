import { describe, expect, it, vi } from "vitest";

import { createAudioRecoveryController } from "./gapless-player-audio-recovery";

describe("gapless player audio recovery controller", () => {
  it("deduplicates concurrent context wake operations", async () => {
    let releaseResume: (() => void) | undefined;
    const resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseResume = resolve;
        }),
    );
    const context = {
      state: "suspended" as AudioContextState,
      resume,
    } as unknown as AudioContext;
    const controller = createAudioRecoveryController({
      getAudioContext: () => context,
      isTauriDesktopRuntime: () => false,
      isPlaybackActive: () => false,
      isOutputStale: () => false,
      markOutputStale: vi.fn(),
      rebuildPlayer: vi.fn(),
      clearOutputStale: vi.fn(),
    });

    const firstWake = controller.prepare("first");
    const secondWake = controller.prepare("second");

    expect(resume).toHaveBeenCalledTimes(1);

    releaseResume?.();
    await Promise.all([firstWake, secondWake]);
  });
});
