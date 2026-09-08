import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { toTrackRowData } from "@/lib/track-row-data";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const navigateMock = vi.hoisted(() => vi.fn());
const toggleTrackLikeMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

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

  it("preserves quality metadata when playback starts from a row queue", async () => {
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
      <TrackRow track={firstTrack} queueTracks={tracks} />,
      {
        playerActions: {
          playAll,
        },
      },
    );

    const user = userEvent.setup();
    await user.click(screen.getAllByText("Track One")[0]!);

    expect(playAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: "entity-1",
          entityUid: "entity-1",
          format: "flac",
          bitrate: 1411,
          sampleRate: 44100,
          bitDepth: 16,
        }),
        expect.objectContaining({
          id: "entity-2",
          entityUid: "entity-2",
          format: "aac",
          bitrate: 320,
          sampleRate: 48000,
          bitDepth: null,
        }),
      ],
      0,
    );
  });

  it("animates the heart when adding a track to the collection", async () => {
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };

    renderWithListenProviders(<TrackRow track={track} />);

    const user = userEvent.setup();
    await user.click(screen.getByTitle("Like"));

    expect(screen.getByTestId("track-like-particles")).toBeInTheDocument();
    expect(screen.getByTestId("track-like-heart")).toHaveClass(
      "crate-follow-heart-in",
    );
    expect(toggleTrackLikeMock).toHaveBeenCalledWith(
      1,
      "entity-1",
      "",
      undefined,
    );
  });

  it("does not activate the row when selecting queue actions from the menu", async () => {
    const playAll = vi.fn();
    const playNext = vi.fn();
    const addToQueue = vi.fn();
    const tracks: TrackRowData[] = [
      {
        id: 1,
        entity_uid: "entity-1",
        title: "Track One",
        artist: "Artist",
        album: "Album",
        album_id: 12,
      },
      {
        id: 2,
        entity_uid: "entity-2",
        title: "Track Two",
        artist: "Artist",
        album: "Album",
        album_id: 12,
      },
    ];

    renderWithListenProviders(
      <TrackRow track={tracks[0]!} queueTracks={tracks} />,
      {
        playerActions: {
          playAll,
          playNext,
          addToQueue,
        },
      },
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Play next" }));

    expect(playNext).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Track One" }),
    );
    expect(playAll).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to queue" }));

    expect(addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Track One" }),
    );
    expect(playAll).not.toHaveBeenCalled();
  });

  it("opens the normal track menu on right click without selecting the row", () => {
    const onSelect = vi.fn();
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };

    renderWithListenProviders(
      <TrackRow track={track} selectable onSelect={onSelect} />,
    );

    fireEvent.contextMenu(screen.getByText("Track One"));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects instead of playing on single click when selectable", async () => {
    const playAll = vi.fn();
    const onSelect = vi.fn();
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };
    const nextTrack: TrackRowData = {
      id: 2,
      entity_uid: "entity-2",
      title: "Track Two",
      artist: "Artist",
      album: "Album",
    };

    renderWithListenProviders(
      <TrackRow
        track={track}
        queueTracks={[track, nextTrack]}
        selectable
        onSelect={onSelect}
      />,
      {
        playerActions: {
          playAll,
        },
      },
    );

    await userEvent.click(screen.getByText("Track One"));

    expect(onSelect).toHaveBeenCalledWith(track, expect.any(Object));
    expect(playAll).not.toHaveBeenCalled();
  });

  it("plays from the leading play control when selectable", async () => {
    const playAll = vi.fn();
    const onSelect = vi.fn();
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };
    const nextTrack: TrackRowData = {
      id: 2,
      entity_uid: "entity-2",
      title: "Track Two",
      artist: "Artist",
      album: "Album",
    };

    renderWithListenProviders(
      <TrackRow
        track={track}
        queueTracks={[track, nextTrack]}
        selectable
        onSelect={onSelect}
      />,
      {
        playerActions: {
          playAll,
        },
      },
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Play Track One" }),
    );

    expect(playAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({ title: "Track One" }),
        expect.objectContaining({ title: "Track Two" }),
      ],
      0,
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("plays from the row on double click when selectable", () => {
    const playAll = vi.fn();
    const tracks: TrackRowData[] = [
      {
        id: 1,
        entity_uid: "entity-1",
        title: "Track One",
        artist: "Artist",
        album: "Album",
      },
      {
        id: 2,
        entity_uid: "entity-2",
        title: "Track Two",
        artist: "Artist",
        album: "Album",
      },
    ];

    renderWithListenProviders(
      <TrackRow track={tracks[0]!} queueTracks={tracks} selectable />,
      {
        playerActions: {
          playAll,
        },
      },
    );

    fireEvent.doubleClick(screen.getByText("Track One"));

    expect(playAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({ title: "Track One" }),
        expect.objectContaining({ title: "Track Two" }),
      ],
      0,
    );
  });

  it("uses selection actions from the row menu button when selected", async () => {
    const playAll = vi.fn();
    const onSelectionActionMenuOpen = vi.fn(() => true);
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };

    renderWithListenProviders(
      <TrackRow
        track={track}
        queueTracks={[track]}
        selectable
        selected
        onSelectionActionMenuOpen={onSelectionActionMenuOpen}
      />,
      {
        playerActions: {
          playAll,
        },
      },
    );

    await userEvent.click(screen.getByRole("button", { name: "More actions" }));

    expect(onSelectionActionMenuOpen).toHaveBeenCalledWith(
      track,
      expect.any(Object),
    );
    expect(playAll).not.toHaveBeenCalled();
  });

  it("opens the track menu instead of selecting on right click", () => {
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };

    renderWithListenProviders(<TrackRow track={track} selectable />);

    fireEvent.contextMenu(screen.getByText("Track One"));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
  });

  it("keeps circular progress and global play glow on the active playing row", () => {
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };

    const { container } = renderWithListenProviders(
      <TrackRow track={track} />,
      {
        playerActions: {
          currentTrack: {
            id: "entity-1",
            entityUid: "entity-1",
            title: "Track One",
            artist: "Artist",
          },
        },
        playerProgress: {
          currentTime: 30,
          duration: 120,
        },
        playerState: {
          isPlaying: true,
        },
      },
    );

    const progress = screen.getByTestId("track-row-playback-progress");

    expect(progress.innerHTML).toContain("animate-crate-play-aura-pulse");
    expect(progress.innerHTML).toContain("animate-crate-play-rim-pulse");
    expect(progress.innerHTML).toContain("animate-crate-play-core-pulse");
    expect(progress.className).not.toContain("conic-gradient");
    expect(progress.innerHTML).not.toContain("conic-gradient");
    expect(container.innerHTML).toContain("stroke-dashoffset");
  });

  it("consumes semantic classes for row states and playback progress", () => {
    const track: TrackRowData = {
      id: 1,
      entity_uid: "entity-1",
      title: "Track One",
      artist: "Artist",
      album: "Album",
    };

    const { container } = renderWithListenProviders(
      <TrackRow track={track} showCoverThumb />,
      {
        playerActions: {
          currentTrack: {
            id: "entity-1",
            entityUid: "entity-1",
            title: "Track One",
            artist: "Artist",
          },
        },
        playerState: {
          isPlaying: true,
        },
      },
    );

    expect(container.firstElementChild).toHaveClass("track-row");
    expect(container.firstElementChild).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("track-row-playback-progress")).toHaveClass(
      "track-row-playback-progress",
    );
    expect(
      screen.getByTestId("track-row-playback-progress").firstElementChild,
    ).toHaveClass("track-row-playback-aura");
  });

  it("uses normalized global album artwork for catalog-only rows", () => {
    const track = toTrackRowData({
      id: "track-global-1",
      globalTrackUid: "track-global-1",
      globalAlbumUid: "album-global-1",
      title: "0151",
      artist: "High Vis",
      album: "Blending",
      availability: {
        catalog: true,
        stream: true,
        import: false,
        local: false,
      },
    });

    const { container } = renderWithListenProviders(
      <TrackRow track={track} showCoverThumb />,
    );

    expect(container.innerHTML).toContain(
      "/api/catalog/albums/album-global-1/cover",
    );
  });
});
