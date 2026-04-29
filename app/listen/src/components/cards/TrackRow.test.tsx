import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const navigateMock = vi.hoisted(() => vi.fn());
const toggleTrackLikeMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/components/actions/ItemActionMenu", () => ({
  ItemActionMenu: () => null,
  ItemActionMenuButton: () => null,
  useItemActionMenu: () => ({
    triggerRef: { current: null },
    hasActions: false,
    openFromTrigger: vi.fn(),
    handleContextMenu: vi.fn(),
    open: false,
    position: null,
    menuRef: { current: null },
    close: vi.fn(),
  }),
}));

vi.mock("@/components/actions/track-actions", () => ({
  useTrackActionEntries: () => [],
}));

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: () => false,
    toggleTrackLike: toggleTrackLikeMock,
  }),
}));

describe("TrackRow playback behavior", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    toggleTrackLikeMock.mockReset();
  });

  it("preserves quality metadata when playback starts from a row queue", () => {
    const playAll = vi.fn();
    const tracks: TrackRowData[] = [
      {
        id: 1,
        entity_uid: "entity-1",
        title: "Track One",
        artist: "Artist",
        album: "Album",
        album_id: 12,
        format: "flac",
        bitrate: 1411,
        sample_rate: 44100,
        bit_depth: 16,
      },
      {
        id: 2,
        entity_uid: "entity-2",
        title: "Track Two",
        artist: "Artist",
        album: "Album",
        album_id: 12,
        format: "aac",
        bitrate: 320,
        sample_rate: 48000,
        bit_depth: null,
      },
    ];
    const firstTrack = tracks[0]!;

    renderWithListenProviders(
      <TrackRow
        track={firstTrack}
        queueTracks={tracks}
      />,
      {
        playerActions: {
          playAll,
        },
      },
    );

    fireEvent.click(screen.getByText("Track One"));

    expect(playAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: "entity-1",
          entityUid: "entity-1",
          storageId: undefined,
          format: "flac",
          bitrate: 1411,
          sampleRate: 44100,
          bitDepth: 16,
        }),
        expect.objectContaining({
          id: "entity-2",
          entityUid: "entity-2",
          storageId: undefined,
          format: "aac",
          bitrate: 320,
          sampleRate: 48000,
          bitDepth: null,
        }),
      ],
      0,
    );
  });
});
