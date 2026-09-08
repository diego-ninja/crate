import { describe, expect, it } from "vitest";

import {
  getPlaylistBadgeLabel,
  getPlaylistOfflinePresentation,
} from "@/components/playlists/playlist-list-row-model";

describe("playlist list row model", () => {
  it("builds offline progress metadata from the stored record", () => {
    expect(
      getPlaylistOfflinePresentation("downloading", {
        key: "playlist:7",
        kind: "playlist",
        entityId: "7",
        title: "Mix",
        state: "downloading",
        trackCount: 12,
        readyTrackCount: 5,
        tracks: [],
      }),
    ).toEqual({
      meta: "5/12 offline",
      toneClass: "text-accent-action",
    });
  });

  it("uses state labels when an offline record has no track count", () => {
    expect(getPlaylistOfflinePresentation("ready", null)).toEqual({
      meta: "Available offline",
      toneClass: "text-text-accent/90",
    });
    expect(getPlaylistOfflinePresentation("error")).toEqual({
      meta: "Offline copy failed",
      toneClass: "text-state-warning-text/90",
    });
  });

  it("only exposes user-facing badges for supported playlist types", () => {
    expect(getPlaylistBadgeLabel(false, "smart")).toBe("Smart");
    expect(getPlaylistBadgeLabel(false, "curated")).toBe("Curated");
    expect(getPlaylistBadgeLabel(false, "personal")).toBeNull();
    expect(getPlaylistBadgeLabel(true, "smart")).toBeNull();
  });
});
