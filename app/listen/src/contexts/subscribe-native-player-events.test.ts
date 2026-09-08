import { describe, expect, it, vi } from "vitest";

import type { PlaybackEngine } from "@/lib/playback-engine";
import {
  NATIVE_PLAYER_EVENT_NAMES,
  type NativePlayerEventHandlers,
  subscribeNativePlayerEvents,
} from "./subscribe-native-player-events";

describe("subscribeNativePlayerEvents", () => {
  it("removes listeners that resolve after the subscription is disposed", async () => {
    const removers = NATIVE_PLAYER_EVENT_NAMES.map(() => vi.fn());
    let resolveFirstListener: (() => void) | undefined;
    const firstListener = new Promise<() => void>((resolve) => {
      resolveFirstListener = () => resolve(removers[0]!);
    });
    let callIndex = 0;
    const engine = {
      on: vi.fn(() => {
        const currentIndex = callIndex++;
        const result =
          currentIndex === 0 ? firstListener : removers[currentIndex];
        return Promise.resolve(result);
      }),
    } as unknown as Pick<PlaybackEngine, "on">;
    const handlers = Object.fromEntries(
      NATIVE_PLAYER_EVENT_NAMES.map((event) => [event, vi.fn()]),
    ) as unknown as NativePlayerEventHandlers;

    const subscription = subscribeNativePlayerEvents(engine, handlers);
    subscription.dispose();
    resolveFirstListener!();
    await subscription.ready;

    expect(engine.on).toHaveBeenCalledTimes(NATIVE_PLAYER_EVENT_NAMES.length);
    for (const remove of removers) {
      expect(remove).toHaveBeenCalledTimes(1);
    }
  });
});
