import { describe, expect, it } from "vitest";

import type { Track } from "@/contexts/player-types";
import { resolveQueueFromUrls } from "@/contexts/player-queue-helpers";

const mk = (id: string): Track => ({ id, title: id, artist: "x" });

describe("resolveQueueFromUrls with duplicates", () => {
  it("preserves distinct Track instances for the same URL", () => {
    const trackA1 = mk("a-instance-1");
    const trackA2 = mk("a-instance-2");
    const trackB = mk("b");

    const urlA = "/stream/a";
    const urlB = "/stream/b";
    const map = new Map<string, Track[]>([
      [urlA, [trackA1, trackA2]],
      [urlB, [trackB]],
    ]);

    const engineUrls = [urlA, urlB, urlA];
    const resolved = resolveQueueFromUrls(engineUrls, [], map);

    expect(resolved).toHaveLength(3);
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

    expect(map.get("/stream/a")).toBe(originalBucket);
    expect(map.get("/stream/a")).toHaveLength(1);
  });

  it("handles more engine slots than map entries via sourceQueue fallback", () => {
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
