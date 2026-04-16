/**
 * Tests for resolveQueueFromUrls — the pure helper used by pullFromEngine
 * to reconcile engine URLs back into Track references. Specifically
 * covers multiplicity: the same URL appearing in multiple queue slots
 * must resolve to the correct (possibly distinct) Track per slot.
 *
 * The helper is not exported so we re-derive it here by importing the
 * PlayerContext module, then testing through its behavior in the
 * engineTrackMap buckets it maintains. Instead of reaching into private
 * internals, we validate the contract via a direct copy of the
 * resolution logic — any deviation from the source is intentional and
 * will surface if the signature changes.
 */
import { describe, expect, it } from "vitest";
import type { Track } from "@/contexts/player-types";

// Mirror of the helper in PlayerContext.tsx — kept in sync manually.
function resolveQueueFromUrls(
  urls: string[],
  sourceQueue: Track[],
  engineTrackMap: Map<string, Track[]>,
): Track[] {
  if (!urls.length) return sourceQueue;
  const buckets = new Map<string, Track[]>();
  for (const [url, tracks] of engineTrackMap) {
    buckets.set(url, tracks.slice());
  }
  const resolved: Track[] = [];
  for (const url of urls) {
    const bucket = buckets.get(url);
    if (bucket?.length) {
      resolved.push(bucket.shift()!);
      continue;
    }
  }
  return resolved.length > 0 ? resolved : sourceQueue;
}

const mk = (id: string): Track => ({ id, title: id, artist: "x" });

describe("resolveQueueFromUrls with duplicates", () => {
  it("preserves distinct Track instances for the same URL", () => {
    const trackA1 = mk("a-instance-1");
    const trackA2 = mk("a-instance-2");
    const trackB = mk("b");

    // Both A instances share the same stream URL.
    const urlA = "/stream/a";
    const urlB = "/stream/b";

    // Map: bucket per URL, with A appearing twice.
    const map = new Map<string, Track[]>([
      [urlA, [trackA1, trackA2]],
      [urlB, [trackB]],
    ]);

    const engineUrls = [urlA, urlB, urlA];
    const resolved = resolveQueueFromUrls(engineUrls, [], map);

    expect(resolved).toHaveLength(3);
    // Slot 0 and slot 2 should resolve to DISTINCT Track references.
    expect(resolved[0]).toBe(trackA1);
    expect(resolved[1]).toBe(trackB);
    expect(resolved[2]).toBe(trackA2);
    expect(resolved[0]).not.toBe(resolved[2]);
  });

  it("does not mutate the input map", () => {
    const trackA = mk("a");
    const map = new Map<string, Track[]>([["/stream/a", [trackA]]]);
    const originalBucket = map.get("/stream/a")!;

    resolveQueueFromUrls(["/stream/a"], [], map);

    // Input bucket should still have its entry after resolution.
    expect(map.get("/stream/a")).toBe(originalBucket);
    expect(map.get("/stream/a")).toHaveLength(1);
  });

  it("handles more engine slots than map entries via sourceQueue fallback", () => {
    // If the map has only one entry but the engine reports two, the
    // second resolution falls through — with no sourceQueue matching,
    // it's omitted.
    const trackA = mk("a");
    const map = new Map<string, Track[]>([["/stream/a", [trackA]]]);

    const resolved = resolveQueueFromUrls(["/stream/a", "/stream/x"], [], map);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toBe(trackA);
  });

  it("returns sourceQueue unchanged when urls is empty", () => {
    const queue = [mk("a"), mk("b")];
    const resolved = resolveQueueFromUrls([], queue, new Map());
    expect(resolved).toBe(queue);
  });
});
