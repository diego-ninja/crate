import type {
  EngineEventListener,
  PlaybackEngine,
} from "@/lib/playback-engine";

export const NATIVE_PLAYER_EVENT_NAMES = [
  "positionChanged",
  "playEventCheckpoint",
  "stateChanged",
  "trackChanged",
  "bufferingChanged",
  "nearQueueEnd",
  "queueEnded",
  "resumeAuthorizationRequired",
  "error",
] as const;

type NativePlayerEventName = (typeof NATIVE_PLAYER_EVENT_NAMES)[number];

export type NativePlayerEventHandlers = {
  [K in NativePlayerEventName]: EngineEventListener<K>;
};

interface NativePlayerEventSubscription {
  ready: Promise<void>;
  dispose: () => void;
}

export function subscribeNativePlayerEvents(
  engine: Pick<PlaybackEngine, "on">,
  handlers: NativePlayerEventHandlers,
): NativePlayerEventSubscription {
  let disposed = false;
  const removers = new Set<() => void>();

  const add = async <K extends NativePlayerEventName>(
    event: K,
    listener: EngineEventListener<K>,
  ) => {
    const remove = await engine.on(event, listener);
    if (disposed) {
      remove();
      return;
    }
    removers.add(remove);
  };

  const ready = (async () => {
    await add("positionChanged", handlers.positionChanged);
    await add("playEventCheckpoint", handlers.playEventCheckpoint);
    await add("stateChanged", handlers.stateChanged);
    await add("trackChanged", handlers.trackChanged);
    await add("bufferingChanged", handlers.bufferingChanged);
    await add("nearQueueEnd", handlers.nearQueueEnd);
    await add("queueEnded", handlers.queueEnded);
    await add(
      "resumeAuthorizationRequired",
      handlers.resumeAuthorizationRequired,
    );
    await add("error", handlers.error);
  })();

  const dispose = () => {
    disposed = true;
    for (const remove of removers) remove();
    removers.clear();
  };

  return { ready, dispose };
}
