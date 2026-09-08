import { describe, expect, it, vi } from "vitest";

import { ArrowDownToLine } from "@crate/ui/icons";

import {
  buildPlaylistMenuItems,
  buildPlaylistSecondaryActions,
  getPlaylistOfflineIcon,
  type PlaylistActionMenuInput,
} from "@/pages/playlist-action-menus";
import type { PlaylistData } from "@/pages/playlist-types";

const playlist = {
  id: 42,
  name: "Screamo",
  is_smart: false,
  is_collaborative: false,
  user_id: 7,
  track_count: 0,
  total_duration: 0,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  tracks: [],
} as PlaylistData;

function buildInput(
  overrides: Partial<PlaylistActionMenuInput> = {},
): PlaylistActionMenuInput {
  return {
    data: playlist,
    offlinePresentation: {
      busy: false,
      progress: null,
      buttonLabel: "Make available offline",
      statusDetail: null,
    },
    offlineState: "idle",
    offlineSupported: true,
    playerTracks: [],
    offlineIcon: ArrowDownToLine,
    handlePlay: vi.fn(),
    handleShuffle: vi.fn(),
    handlePlaylistRadio: vi.fn(),
    handleRegenerate: vi.fn(),
    handleShare: vi.fn(),
    handleToggleOffline: vi.fn(),
    setDeleteOpen: vi.fn(),
    setEditorOpen: vi.fn(),
    setMembersOpen: vi.fn(),
    t: ((key: string) => key) as PlaylistActionMenuInput["t"],
    ...overrides,
  };
}

describe("playlist action menus", () => {
  it("returns empty menus while the playlist is unavailable", () => {
    const input = buildInput({ data: undefined });

    expect(buildPlaylistSecondaryActions(input)).toEqual([]);
    expect(buildPlaylistMenuItems(input)).toEqual([]);
  });

  it("keeps the regular playlist action order and visibility", () => {
    const input = buildInput();

    expect(
      buildPlaylistSecondaryActions(input).map((action) => action.key),
    ).toEqual(["radio", "offline", "edit", "share"]);
    expect(buildPlaylistMenuItems(input).map((item) => item.key)).toEqual([
      "play",
      "shuffle",
      "radio",
      "playlist-state-divider",
      "offline",
      "edit",
      "share",
      "playlist-danger-divider",
      "delete",
    ]);
  });

  it("adds collaborator and smart-playlist actions only when applicable", () => {
    const input = buildInput({
      data: { ...playlist, is_smart: true, is_collaborative: true },
    });

    expect(
      buildPlaylistSecondaryActions(input).map((action) => action.key),
    ).toContain("collaborators");
    expect(buildPlaylistMenuItems(input).map((item) => item.key)).toEqual([
      "play",
      "shuffle",
      "radio",
      "playlist-state-divider",
      "offline",
      "collaborators",
      "edit",
      "regenerate",
      "share",
      "playlist-danger-divider",
      "delete",
    ]);
  });

  it("uses the download icon state shared by both menu surfaces", () => {
    expect(
      getPlaylistOfflineIcon("idle", buildInput().offlinePresentation),
    ).toBe(ArrowDownToLine);
    expect(
      getPlaylistOfflineIcon("ready", buildInput().offlinePresentation),
    ).not.toBe(ArrowDownToLine);
  });
});
