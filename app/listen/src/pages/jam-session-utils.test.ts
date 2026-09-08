import { describe, expect, it } from "vitest";

import type { Track } from "@/contexts/player-types";
import type { JamEvent, JamMember, SearchTrack } from "@/pages/jam-reducer";
import {
  displayName,
  eventActivityText,
  extractInviteToken,
  formatRoomTagsInput,
  initials,
  parseRoomTags,
  resolveJamActor,
  searchTrackToTrack,
  trackIdentity,
  trackToPayload,
} from "@/pages/jam-session-utils";

describe("jam session utilities", () => {
  it("normalizes room tags while keeping the first twelve unique values", () => {
    const input = Array.from({ length: 14 }, (_, index) => ` Tag ${index} `)
      .concat(["tag 1", "", "  "])
      .join(",");

    expect(parseRoomTags(input)).toEqual(
      Array.from({ length: 12 }, (_, index) => `tag ${index}`),
    );
    expect(formatRoomTagsInput(["rock", "hardcore"])).toBe("rock, hardcore");
  });

  it("extracts invite tokens from links and raw values", () => {
    expect(extractInviteToken("https://listen.example/jam/invite/abc123")).toBe(
      "abc123",
    );
    expect(extractInviteToken(" /abc123/ ")).toBe("abc123/");
    expect(extractInviteToken("   ")).toBe("");
  });

  it("resolves display names and initials consistently", () => {
    expect(displayName({ display_name: "  Diego  ", username: "diego" })).toBe(
      "Diego",
    );
    expect(displayName({ username: "diego" })).toBe("diego");
    expect(displayName({ user_id: 42 })).toBe("User 42");
    expect(initials("Diego Ninja")).toBe("DN");
    expect(initials("Single")).toBe("S");
  });

  it("uses stable canonical identifiers for room tracks", () => {
    const track = {
      id: "legacy-id",
      entityUid: "entity-1",
      globalTrackUid: "global-1",
      title: "Track",
      artist: "Artist",
      album: "Album",
      duration: 180,
      path: "/music/track.flac",
    } as Track;

    expect(trackIdentity(track)).toBe("global-1");
    expect(trackToPayload(track)).toMatchObject({
      id: "legacy-id",
      globalTrackUid: "global-1",
      entityUid: "entity-1",
      title: "Track",
    });
  });

  it("maps catalog search tracks to playable room tracks", () => {
    const searchTrack: SearchTrack = {
      id: 7,
      title: "Track",
      artist: "Artist",
      album: "Album",
      album_id: 9,
      path: "/music/track.flac",
    };

    expect(searchTrackToTrack(searchTrack)).toMatchObject({
      id: "/music/track.flac",
      title: "Track",
      artist: "Artist",
      album: "Album",
      libraryTrackId: 7,
    });
  });

  it("resolves event actors from room members and current user", () => {
    const event: JamEvent = {
      id: 1,
      room_id: "room",
      user_id: 2,
      event_type: "join",
      created_at: "2026-01-01T00:00:00Z",
    };
    const member = {
      user_id: 2,
      username: "member",
      display_name: "Member",
    } as JamMember;

    expect(resolveJamActor(event, [member])).toEqual({
      name: "Member",
      avatar: null,
      user_id: 2,
    });
  });

  it("localizes activity text using the resolved actor and track", () => {
    const translations = {
      "jam.activity.queueAdd": ({
        actor,
        title,
      }: {
        actor: string;
        title: string;
      }) => `${actor} added ${title}`,
      "jam.activity.aTrack": () => "a track",
    };
    const t = ((key: string, options?: Record<string, string>) =>
      translations[key as keyof typeof translations]?.(options as never) ??
      key) as never;
    const event: JamEvent = {
      id: 1,
      room_id: "room",
      user_id: 2,
      event_type: "queue_add",
      payload_json: {
        track: { id: "track-1", title: "Track", artist: "Artist" },
      },
      created_at: "2026-01-01T00:00:00Z",
    };

    expect(eventActivityText(event, "Member", t)).toBe("Member added Track");
  });
});
