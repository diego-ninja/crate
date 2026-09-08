import { getStreamUrl } from "@/contexts/player-utils";
import type { Track } from "@/contexts/player-types";
import { isOnline as isRuntimeOnline } from "@/lib/capacitor";

const STREAM_PROBE_TIMEOUT_MS = 4000;

export async function probeTrackAvailability(
  track: Track | undefined,
): Promise<boolean> {
  if (!track) return false;

  const online = await isRuntimeOnline();
  if (!online) return false;

  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    STREAM_PROBE_TIMEOUT_MS,
  );
  try {
    const response = await fetch(getStreamUrl(track), {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    response.body?.cancel().catch(() => {});
    return response.ok || response.status === 206;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}
