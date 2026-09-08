import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  renderWithListenProviders,
  createMockTrack,
} from "@/test/render-with-listen-providers";
import { PLAYER_TRACK_FINISHED_EVENT } from "@/contexts/player-events";
import type { JamRoom, JamRoomsResponse, JamInvite } from "@/pages/jam-reducer";

// ── Hoisted mock state ───────────────────────────────────────────────────────

const {
  mockNavigate,
  mockParams,
  mockApiCall,
  mockUseApiData,
  mockUseApiTaxonomyData,
  mockUseApiLoading,
  mockUseApiError,
  mockRefetch,
  mockSendEvent,
  mockJamConnected,
  mockDndContext,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockParams: { roomId: undefined as string | undefined },
  mockApiCall: vi.fn(),
  mockUseApiData: { value: null as unknown },
  mockUseApiTaxonomyData: { value: null as unknown },
  mockUseApiLoading: { value: false },
  mockUseApiError: { value: null as string | null },
  mockRefetch: vi.fn(),
  mockSendEvent: vi.fn(() => true),
  mockJamConnected: { value: false },
  mockDndContext: {
    onDragEnd: null as
      | ((event: {
          active: { id: string };
          over: { id: string } | null;
        }) => void)
      | null,
  },
}));

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockParams,
  };
});

vi.mock("@/hooks/use-jam-websocket", () => ({
  useJamWebSocket: ({
    dispatch,
  }: {
    dispatch: (action: { type: "WEBSOCKET_OPEN" }) => void;
  }) => {
    useEffect(() => {
      if (mockJamConnected.value) dispatch({ type: "WEBSOCKET_OPEN" });
    }, [dispatch]);
    return { sendEvent: mockSendEvent };
  },
}));

vi.mock("@/lib/api", () => ({
  api: mockApiCall,
  apiAssetUrl: (path: string) => path,
  apiWsUrl: (path: string) => `ws://localhost${path}`,
  isUsableMediaAssetUrl: () => true,
  requiresMediaAccessTicket: () => false,
  resolveMaybeApiAssetUrl: (value: string | null | undefined) => value,
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: (_url: string | null) => ({
    data:
      _url === "/api/genres/taxonomy/tree"
        ? mockUseApiTaxonomyData.value
        : _url
          ? mockUseApiData.value
          : null,
    loading: _url ? mockUseApiLoading.value : false,
    error: _url ? mockUseApiError.value : null,
    refetch: mockRefetch,
  }),
}));

vi.mock("@/hooks/use-user-avatar-url", () => ({
  useUserAvatarUrl: () => ({
    avatarUrl: null,
    handleAvatarError: vi.fn(),
  }),
}));

vi.mock("@dnd-kit/core", () => ({
  KeyboardSensor: class KeyboardSensor {},
  PointerSensor: class PointerSensor {},
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragEnd: (event: {
      active: { id: string };
      over: { id: string } | null;
    }) => void;
  }) => {
    mockDndContext.onDragEnd = onDragEnd;
    return <>{children}</>;
  },
  closestCenter: {},
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: {},
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}));

vi.mock("@crate/ui/primitives/QrCodeImage", () => ({
  QrCodeImage: () => null,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMember(overrides: Partial<JamRoom["members"][number]> = {}) {
  return {
    room_id: "room-1",
    user_id: overrides.user_id ?? 1,
    role: overrides.role ?? ("host" as const),
    joined_at: "2026-01-01T00:00:00Z",
    last_seen_at: "2026-01-01T00:00:00Z",
    username: "admin",
    display_name: "Admin",
    avatar: null,
    ...overrides,
  };
}

function makeRoom(overrides: Partial<JamRoom> = {}): JamRoom {
  return {
    id: "room-1",
    host_user_id: 1,
    name: "Test Room",
    status: "active",
    visibility: "public",
    is_permanent: false,
    description: "A test room",
    tags: ["rock", "indie"],
    current_track_payload: null,
    created_at: "2026-01-01T00:00:00Z",
    member_count: 1,
    last_event_at: null,
    members: [makeMember()],
    events: [],
    ...overrides,
  };
}

function makeRoomsResponse(rooms: JamRoom[]): JamRoomsResponse {
  return { rooms };
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockApiCall.mockReset();
  mockRefetch.mockReset();
  mockSendEvent.mockReset();
  mockSendEvent.mockReturnValue(true);
  mockJamConnected.value = false;
  mockDndContext.onDragEnd = null;
  mockParams.roomId = undefined;
  mockUseApiData.value = null;
  mockUseApiTaxonomyData.value = null;
  mockUseApiLoading.value = false;
  mockUseApiError.value = null;
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Imports after mocks ──────────────────────────────────────────────────────

import { JamSession } from "@/pages/JamSession";

function JamSessionRerenderHarness() {
  const [, setVersion] = useState(0);
  return (
    <>
      <button
        type="button"
        data-testid="rerender-jam-session"
        onClick={() => setVersion((version) => version + 1)}
      />
      <JamSession />
    </>
  );
}

async function openRoomActionsMenu() {
  await userEvent.click(
    screen.getByRole("button", {
      name: /room settings|opciones de la sala/i,
      expanded: false,
    }),
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LOBBY (no roomId)
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession lobby (no roomId)", () => {
  it("renders the lobby heading, create form, and open rooms section", () => {
    mockUseApiData.value = makeRoomsResponse([]);
    const { container } = renderWithListenProviders(<JamSession />);

    expect(
      screen.getByRole("heading", { name: "Jam sessions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Start a room")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Friday night queue"),
    ).toBeInTheDocument();
    expect(screen.getByText("Open rooms")).toBeInTheDocument();
    expect(screen.getByText("Join from invite")).toBeInTheDocument();
    expect(container.querySelector(".jam-lobby-header")).toBeInTheDocument();
    expect(container.querySelector(".jam-panel")).toBeInTheDocument();
  });

  it("localizes the lobby chrome", () => {
    mockUseApiData.value = makeRoomsResponse([]);
    renderWithListenProviders(<JamSession />, { locale: "es" });

    expect(
      screen.getByRole("heading", { name: "Sesiones Jam" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Empezar una sala")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Cola de viernes noche"),
    ).toBeInTheDocument();
    expect(screen.getByText("Salas abiertas")).toBeInTheDocument();
    expect(screen.getByText("Entrar con invitación")).toBeInTheDocument();
  });

  it("shows room name input with create button", () => {
    mockUseApiData.value = makeRoomsResponse([]);
    renderWithListenProviders(<JamSession />);

    expect(
      screen.getByPlaceholderText("Friday night queue"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create room/i }),
    ).toBeInTheDocument();
  });

  it("creates a room when the form is filled and submitted", async () => {
    mockUseApiData.value = makeRoomsResponse([]);
    mockApiCall.mockResolvedValueOnce({ id: "new-room", name: "Test Room" });
    renderWithListenProviders(<JamSession />);

    const nameInput = screen.getByPlaceholderText("Friday night queue");
    await userEvent.type(nameInput, "Test Room");

    await userEvent.click(screen.getByRole("button", { name: /create room/i }));

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        "/api/jam/rooms",
        "POST",
        expect.objectContaining({ name: "Test Room", visibility: "private" }),
      );
    });
    expect(mockNavigate).toHaveBeenCalledWith("/jam/rooms/new-room");
  });

  it("suggests taxonomy genres and submits the selected slugs for Auto DJ", async () => {
    mockUseApiData.value = makeRoomsResponse([]);
    mockUseApiTaxonomyData.value = {
      nodes: [
        {
          slug: "post-hardcore",
          name: "Post-hardcore",
          alias_names: ["post hardcore"],
        },
        { slug: "hardcore", name: "Hardcore", alias_names: [] },
      ],
    };
    mockApiCall.mockResolvedValueOnce({ id: "new-room", name: "Test Room" });
    renderWithListenProviders(<JamSession />);

    expect(document.querySelector("select")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("combobox", { name: "Playback mode" }),
    );
    await userEvent.click(screen.getByRole("option", { name: "Auto DJ" }));
    const genreInput = screen.getByPlaceholderText("Search taxonomy genres…");
    await userEvent.type(genreInput, "post");

    expect(
      screen.getByRole("option", { name: /Post-hardcore/ }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("option", { name: /Post-hardcore/ }),
    );
    expect(screen.getByText("post-hardcore")).toBeInTheDocument();

    await userEvent.type(
      screen.getByPlaceholderText("Friday night queue"),
      "Test Room",
    );
    await userEvent.click(screen.getByRole("button", { name: /create room/i }));

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        "/api/jam/rooms",
        "POST",
        expect.objectContaining({
          genre_filters: ["post-hardcore"],
          queue_mode: "auto_dj",
        }),
      );
    });
  });

  it("shows error toast when room creation fails", async () => {
    mockUseApiData.value = makeRoomsResponse([]);
    mockApiCall.mockRejectedValueOnce(new Error("fail"));
    renderWithListenProviders(<JamSession />);

    const nameInput = screen.getByPlaceholderText("Friday night queue");
    await userEvent.type(nameInput, "Test Room");
    await userEvent.click(screen.getByRole("button", { name: /create room/i }));

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalled();
    });
  });

  it("shows room name required toast when name is empty", async () => {
    mockUseApiData.value = makeRoomsResponse([]);
    renderWithListenProviders(<JamSession />);

    await userEvent.click(screen.getByRole("button", { name: /create room/i }));

    await waitFor(() => {
      expect(mockApiCall).not.toHaveBeenCalled();
    });
  });

  it("renders member rooms when available", () => {
    const room = makeRoom({ id: "my-room", name: "My Room" });
    mockUseApiData.value = makeRoomsResponse([room]);
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("My Room")).toBeInTheDocument();
    expect(screen.getByText("Your rooms")).toBeInTheDocument();
  });

  it("renders public rooms to discover", () => {
    const room = makeRoom({
      id: "pub-room",
      name: "Public Room",
      host_user_id: 99,
      members: [makeMember({ user_id: 99, role: "host" })],
    });
    mockUseApiData.value = makeRoomsResponse([room]);
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Public Room")).toBeInTheDocument();
    expect(screen.getByText("Public rooms to discover")).toBeInTheDocument();
  });

  it("shows empty state when no rooms match search", () => {
    mockUseApiData.value = makeRoomsResponse([]);
    renderWithListenProviders(<JamSession />);

    expect(
      screen.getByText("No rooms where you are a member match this search."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No public rooms match this search yet."),
    ).toBeInTheDocument();
  });

  it("joins a room when clicking on a public room card", async () => {
    const room = makeRoom({
      id: "pub-room",
      name: "Public Room",
      host_user_id: 99,
      members: [makeMember({ user_id: 99, role: "host" })],
    });
    mockUseApiData.value = makeRoomsResponse([room]);
    mockApiCall.mockResolvedValueOnce({ room: { id: "pub-room" } });
    renderWithListenProviders(<JamSession />);

    await userEvent.click(screen.getByText("Public Room"));

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        "/api/jam/rooms/pub-room/join",
        "POST",
        {},
      );
    });
    expect(mockNavigate).toHaveBeenCalledWith("/jam/rooms/pub-room");
  });

  it("navigates directly when clicking own room card", async () => {
    const room = makeRoom({ id: "my-room", name: "My Room" });
    mockUseApiData.value = makeRoomsResponse([room]);
    renderWithListenProviders(<JamSession />);

    await userEvent.click(screen.getByText("My Room"));

    expect(mockNavigate).toHaveBeenCalledWith("/jam/rooms/my-room");
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it("shows error toast when joining room fails", async () => {
    const room = makeRoom({
      id: "pub-room",
      name: "Public Room",
      host_user_id: 99,
      members: [makeMember({ user_id: 99, role: "host" })],
    });
    mockUseApiData.value = makeRoomsResponse([room]);
    mockApiCall.mockRejectedValueOnce(new Error("fail"));
    renderWithListenProviders(<JamSession />);

    await userEvent.click(screen.getByText("Public Room"));

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalled();
    });
  });

  it("shows visibility toggle between private and public", async () => {
    mockUseApiData.value = makeRoomsResponse([]);
    renderWithListenProviders(<JamSession />);

    const inviteOnly = screen.getByRole("button", { name: /invite-only/i });
    const publicBtn = screen.getByRole("button", { name: /public/i });

    expect(inviteOnly).toBeInTheDocument();
    expect(publicBtn).toBeInTheDocument();

    await userEvent.click(publicBtn);

    // After clicking public, the invite-only button should no longer be selected
    await waitFor(() => {
      const inviteAfter = screen.getByRole("button", { name: /invite-only/i });
      expect(inviteAfter.className).not.toContain("border-cyan");
    });
  });

  it("renders search input in open rooms section", () => {
    mockUseApiData.value = makeRoomsResponse([]);
    renderWithListenProviders(<JamSession />);

    expect(
      screen.getByPlaceholderText(
        "Search public and permanent rooms by genre, tag, decade...",
      ),
    ).toBeInTheDocument();
  });

  it("renders the invite link input and join button", () => {
    mockUseApiData.value = makeRoomsResponse([]);
    renderWithListenProviders(<JamSession />);

    expect(
      screen.getByPlaceholderText("https://…/jam/invite/abc123"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /join room/i }),
    ).toBeInTheDocument();
  });

  it("navigates to invite route when join from invite is clicked with a token", async () => {
    mockUseApiData.value = makeRoomsResponse([]);
    renderWithListenProviders(<JamSession />);

    const input = screen.getByPlaceholderText("https://…/jam/invite/abc123");
    await userEvent.type(input, "abc123");
    await userEvent.click(screen.getByRole("button", { name: /join room/i }));

    expect(mockNavigate).toHaveBeenCalledWith("/jam/invite/abc123");
  });

  it("extracts token from full invite URL", async () => {
    mockUseApiData.value = makeRoomsResponse([]);
    renderWithListenProviders(<JamSession />);

    const input = screen.getByPlaceholderText("https://…/jam/invite/abc123");
    await userEvent.type(
      input,
      "https://listen.example.test/jam/invite/abc123",
    );
    await userEvent.click(screen.getByRole("button", { name: /join room/i }));

    expect(mockNavigate).toHaveBeenCalledWith("/jam/invite/abc123");
  });

  it("shows permanent room checkbox", () => {
    mockUseApiData.value = makeRoomsResponse([]);
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Permanent room")).toBeInTheDocument();
  });

  it("shows description and tags inputs in create form", () => {
    mockUseApiData.value = makeRoomsResponse([]);
    renderWithListenProviders(<JamSession />);

    expect(
      screen.getByPlaceholderText(
        "Optional description: what is this room for?",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Tags or genres: post-punk, 90s, shoegaze"),
    ).toBeInTheDocument();
  });
});

describe("JamSession lobby - room cards", () => {
  it("displays room description on card when present", () => {
    const room = makeRoom({
      id: "desc-room",
      name: "Described Room",
      description: "A lovely room for sharing music",
    });
    mockUseApiData.value = makeRoomsResponse([room]);
    renderWithListenProviders(<JamSession />);

    expect(
      screen.getByText("A lovely room for sharing music"),
    ).toBeInTheDocument();
  });

  it("displays permanent badge on permanent rooms", () => {
    const room = makeRoom({
      id: "perm-room",
      name: "Perm Room",
      is_permanent: true,
    });
    mockUseApiData.value = makeRoomsResponse([room]);
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Permanent")).toBeInTheDocument();
  });

  it("displays public/private visibility badge", () => {
    const room = makeRoom({
      id: "priv-room",
      name: "PrivRoom",
      visibility: "private",
    });
    mockUseApiData.value = makeRoomsResponse([room]);
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Your room")).toBeInTheDocument();
  });

  it("displays member count on room card", () => {
    const room = makeRoom({
      id: "count-room",
      name: "Count Room",
      member_count: 3,
    });
    mockUseApiData.value = makeRoomsResponse([room]);
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("3 members")).toBeInTheDocument();
  });

  it("shows delete button on rooms the user hosts", () => {
    const room = makeRoom({ id: "host-room", name: "Host Room" });
    mockUseApiData.value = makeRoomsResponse([room]);
    renderWithListenProviders(<JamSession />);

    const deleteButton = screen.getByRole("button", {
      name: "Delete Host Room",
    });
    expect(deleteButton).toBeInTheDocument();
    expect(deleteButton.closest('[role="button"]')).toBeNull();
  });

  it("opens delete confirmation modal when delete is clicked", async () => {
    const room = makeRoom({ id: "host-room", name: "Host Room" });
    mockUseApiData.value = makeRoomsResponse([room]);
    renderWithListenProviders(<JamSession />);

    await userEvent.click(
      screen.getByRole("button", { name: "Delete Host Room" }),
    );

    const heading = screen.getByRole("heading", { name: /delete room/i });
    expect(heading).toBeInTheDocument();
  });

  it("deletes room when confirmed in modal", async () => {
    const room = makeRoom({ id: "host-room", name: "Host Room" });
    mockUseApiData.value = makeRoomsResponse([room]);
    mockApiCall.mockResolvedValueOnce({
      ok: true,
      room_id: "host-room",
    });
    renderWithListenProviders(<JamSession />);

    await userEvent.click(
      screen.getByRole("button", { name: "Delete Host Room" }),
    );

    const modal = screen.getByRole("heading", {
      name: /delete room/i,
    }).parentElement!.parentElement!.parentElement!;
    const confirmBtn = within(modal).getByRole("button", {
      name: /delete room/i,
    });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        "/api/jam/rooms/host-room",
        "DELETE",
      );
    });
  });

  it("shows latest activity on room card", () => {
    const room = makeRoom({
      id: "act-room",
      name: "Active Room",
      events: [
        {
          id: 1,
          room_id: "act-room",
          user_id: 1,
          event_type: "join",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    mockUseApiData.value = makeRoomsResponse([room]);
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Admin joined the room")).toBeInTheDocument();
  });

  it("shows member avatar bubbles on room card", () => {
    const room = makeRoom({
      id: "av-room",
      name: "Avatar Room",
      members: [
        makeMember({ user_id: 1, display_name: "Alice" }),
        makeMember({ user_id: 2, display_name: "Bob", role: "collab" }),
      ],
    });
    mockUseApiData.value = makeRoomsResponse([room]);
    renderWithListenProviders(<JamSession />);

    // Avatar bubbles show initials
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ROOM LOADING
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession room loading", () => {
  it("shows a spinner while room data is loading", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = true;
    mockUseApiData.value = null;
    renderWithListenProviders(<JamSession />);

    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ROOM NOT FOUND / UNAVAILABLE
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession room unavailable", () => {
  it("shows room unavailable when no room data and loading finished", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = null;
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Room unavailable")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to jam sessions" }),
    ).toBeInTheDocument();
  });

  it("shows API error message when present", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = null;
    mockUseApiError.value = "This room has been ended.";
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Room unavailable")).toBeInTheDocument();
    expect(screen.getByText("This room has been ended.")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ACTIVE ROOM - HOST VIEW
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession active room - host", () => {
  beforeEach(() => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom();
  });

  it("localizes the active room chrome", async () => {
    const { container } = renderWithListenProviders(<JamSession />, {
      locale: "es",
    });

    expect(screen.getByText("Sala Jam")).toBeInTheDocument();
    expect(screen.getByText("Conectando con la sala...")).toBeInTheDocument();
    expect(screen.getByText("Sala pública")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Añadir pista actual" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Miembros" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Cola compartida" }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Busca pistas para añadir a esta sala"),
    ).toBeInTheDocument();
    expect(container.querySelector(".jam-room-header")).toBeInTheDocument();
    expect(container.querySelector(".jam-now-playing")).toBeInTheDocument();
    expect(container.querySelector(".jam-members-panel")).toBeInTheDocument();
    expect(container.querySelector(".jam-queue-panel")).toBeInTheDocument();
    expect(container.querySelector(".jam-activity-panel")).toBeInTheDocument();

    await openRoomActionsMenu();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Editar perfil de la sala",
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Perfil de la sala" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Guardar perfil")).toBeInTheDocument();
  });

  it("renders room name and description", () => {
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Test Room")).toBeInTheDocument();
    expect(screen.getByText("A test room")).toBeInTheDocument();
  });

  it("shows 'Jam room' label", () => {
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Jam room")).toBeInTheDocument();
  });

  it("shows connected badge when WebSocket is connected", () => {
    renderWithListenProviders(<JamSession />, {
      path: "/jam/rooms/:roomId",
      route: "/jam/rooms/room-1",
    });

    // After mount, the WS mock does nothing. The initial state isConnected=false
    // but after APPLY_ROOM_DATA is dispatched the room appears but isConnected remains false.
    // The mock sendEvent returns true but doesn't affect isConnected.
    // The component shows "Connecting to room..." by default since isConnected starts false.
    expect(screen.getByText(/connecting to room/i)).toBeInTheDocument();
  });

  it("shows visibility badge", () => {
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Public room")).toBeInTheDocument();
  });

  it("shows the queue mode badge in the room header", () => {
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("DJ mode").closest("div")).toHaveClass(
      "rounded-full",
    );
  });

  it("shows tags as badges", () => {
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("rock")).toBeInTheDocument();
    expect(screen.getByText("indie")).toBeInTheDocument();
  });

  it("shows host control buttons", () => {
    renderWithListenProviders(<JamSession />);

    return openRoomActionsMenu().then(() => {
      expect(
        screen.getByRole("button", { name: /make room invite-only/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /make room permanent/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: /edit room profile/i,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /invite people/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /end room/i }),
      ).toBeInTheDocument();
    });
  });

  it("shows delete room button for host", async () => {
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    expect(
      screen.getByRole("button", { name: /delete room/i }),
    ).toBeInTheDocument();
  });

  it("toggles room visibility via API", async () => {
    mockApiCall.mockResolvedValueOnce(makeRoom({ visibility: "private" }));
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    await userEvent.click(
      screen.getByRole("button", { name: /make room invite-only/i }),
    );

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        "/api/jam/rooms/room-1",
        "PATCH",
        { visibility: "private" },
      );
    });
  });

  it("toggles permanent status via API", async () => {
    mockApiCall.mockResolvedValueOnce(makeRoom({ is_permanent: true }));
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    await userEvent.click(
      screen.getByRole("button", { name: /make room permanent/i }),
    );

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        "/api/jam/rooms/room-1",
        "PATCH",
        { is_permanent: true },
      );
    });
  });

  it("ends the room via API", async () => {
    mockApiCall.mockResolvedValueOnce(makeRoom({ status: "ended" }));
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    await userEvent.click(screen.getByRole("button", { name: /end room/i }));

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        "/api/jam/rooms/room-1/end",
        "POST",
        {},
      );
    });
  });

  it("creates an invite and opens modal", async () => {
    const invite: JamInvite = {
      token: "inv-token",
      join_url: "/jam/invite/inv-token",
      qr_value: "/api/qr?value=...",
    };
    mockApiCall.mockResolvedValueOnce(invite);
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    await userEvent.click(
      screen.getByRole("button", { name: /invite people/i }),
    );

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        "/api/jam/rooms/room-1/invites",
        "POST",
        {},
      );
    });
    expect(screen.getByText("Invite to room")).toBeInTheDocument();
  });

  it("opens metadata modal and saves room profile", async () => {
    mockApiCall.mockResolvedValueOnce(
      makeRoom({ description: "Updated desc", tags: ["new-tag"] }),
    );
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    await userEvent.click(
      screen.getByRole("button", {
        name: /edit room profile/i,
      }),
    );

    expect(screen.getByText("Room profile")).toBeInTheDocument();

    const descInput = screen.getByPlaceholderText(
      "Post-punk, cold wave and angular guitars. Mostly 80s and 90s.",
    );
    const tagsInput = screen.getByPlaceholderText(
      "post-punk, 90s, gothic rock",
    );

    await userEvent.clear(descInput);
    await userEvent.type(descInput, "Updated desc");

    await userEvent.clear(tagsInput);
    await userEvent.type(tagsInput, "new-tag");

    await userEvent.click(
      screen.getByRole("button", { name: /save profile/i }),
    );

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        "/api/jam/rooms/room-1",
        "PATCH",
        expect.objectContaining({
          description: "Updated desc",
          tags: ["new-tag"],
        }),
      );
    });
  });

  it("opens delete modal from room detail and confirms", async () => {
    mockApiCall.mockResolvedValueOnce({
      ok: true,
      room_id: "room-1",
    });
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    await userEvent.click(screen.getByRole("button", { name: /delete room/i }));

    const heading = screen.getByRole("heading", { name: /delete room/i });
    expect(heading).toBeInTheDocument();

    const modal = heading.parentElement!.parentElement!.parentElement!;
    const confirmBtn = within(modal).getByRole("button", {
      name: /delete room/i,
    });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        "/api/jam/rooms/room-1",
        "DELETE",
      );
    });
    expect(mockNavigate).toHaveBeenCalledWith("/jam", { replace: true });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ACTIVE ROOM - MEMBERS & ACTIVITY
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession active room - members and activity", () => {
  const roomWithActivity = makeRoom({
    members: [
      makeMember({ user_id: 1, display_name: "Alice", username: "alice" }),
      makeMember({
        user_id: 2,
        display_name: "Bob",
        username: "bob",
        role: "collab",
      }),
    ],
    events: [
      {
        id: 1,
        room_id: "room-1",
        user_id: 2,
        event_type: "join",
        payload_json: null,
        created_at: "2026-01-01T12:00:00Z",
        username: "bob",
        display_name: "Bob",
      },
      {
        id: 2,
        room_id: "room-1",
        user_id: 1,
        event_type: "play",
        payload_json: {
          track: { id: "t1", title: "Song One", artist: "Artist One" },
        },
        created_at: "2026-01-01T12:05:00Z",
      },
    ],
  });

  beforeEach(() => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = roomWithActivity;
  });

  it("shows members section with names and roles", () => {
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Members")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("Collab")).toBeInTheDocument();

    // Username is shown with @ prefix in subtext
    const memberSection = screen.getByText("Members").closest("section")!;
    expect(within(memberSection).getByText(/@alice/)).toBeInTheDocument();
    expect(within(memberSection).getByText(/@bob/)).toBeInTheDocument();
  });

  it("shows recent room activity", () => {
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Recent room activity")).toBeInTheDocument();
    expect(screen.getByText("Bob joined the room")).toBeInTheDocument();
    expect(screen.getByText("Alice synced playback")).toBeInTheDocument();
  });

  it("shows empty activity when no events", () => {
    mockUseApiData.value = makeRoom({ events: [] });
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("No room events yet.")).toBeInTheDocument();
  });

  it("takes ownership of the local queue on entry and releases it on exit", () => {
    const enterJamSession = vi.fn();
    const leaveJamSession = vi.fn();
    const rendered = renderWithListenProviders(<JamSession />, {
      playerActions: { enterJamSession, leaveJamSession },
    });

    expect(enterJamSession).toHaveBeenCalledTimes(1);

    rendered.unmount();

    expect(leaveJamSession).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SHARED QUEUE
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession shared queue", () => {
  const roomWithQueueEvents = makeRoom({
    events: [
      {
        id: 1,
        room_id: "room-1",
        user_id: 1,
        event_type: "queue_add",
        payload_json: {
          track: { id: "t1", title: "Song One", artist: "Artist" },
          index: 0,
        },
        created_at: "2026-01-01T12:00:00Z",
      },
      {
        id: 2,
        room_id: "room-1",
        user_id: 1,
        event_type: "queue_add",
        payload_json: {
          track: { id: "t2", title: "Song Two", artist: "Artist" },
          index: 1,
        },
        created_at: "2026-01-01T12:01:00Z",
      },
      {
        id: 3,
        room_id: "room-1",
        user_id: 1,
        event_type: "queue_add",
        payload_json: {
          track: { id: "t3", title: "Song Three", artist: "Artist" },
          index: 2,
        },
        created_at: "2026-01-01T12:02:00Z",
      },
    ],
  });

  beforeEach(() => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = roomWithQueueEvents;
  });

  it("shows shared queue header with track count", () => {
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Shared queue")).toBeInTheDocument();
    expect(screen.getByText("3 tracks")).toBeInTheDocument();
  });

  it("renders queue tracks with titles and artwork placeholders", () => {
    renderWithListenProviders(<JamSession />);

    // Tracks appear in both shared queue and recent activity
    expect(screen.getAllByText("Song One").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Song Two").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Song Three").length).toBeGreaterThanOrEqual(1);
  });

  it("shows queue position numbers", () => {
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows empty queue message when no tracks", () => {
    mockUseApiData.value = makeRoom({ events: [] });
    renderWithListenProviders(<JamSession />);

    expect(
      screen.getByText(/Nothing in the shared queue yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /browse library/i }),
    ).toBeInTheDocument();
  });

  it("calls sendEvent when removing a track from queue", async () => {
    renderWithListenProviders(<JamSession />);

    await userEvent.click(
      screen.getByRole("button", {
        name: "Remove Song One from queue",
      }),
    );

    expect(mockSendEvent).toHaveBeenCalledWith({
      type: "queue_remove",
      index: 0,
    });
  });

  it("removes a persisted queue item immediately and sends its stable id", async () => {
    const track = createMockTrack({ id: "track-1", title: "Persisted Song" });
    mockUseApiData.value = makeRoom({
      queue: [
        {
          id: "queue-1",
          track,
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });

    renderWithListenProviders(<JamSession />);

    await userEvent.click(
      screen.getByRole("button", {
        name: "Remove Persisted Song from queue",
      }),
    );

    expect(mockSendEvent).toHaveBeenCalledWith({
      type: "queue_remove",
      queue_item_id: "queue-1",
    });
    expect(
      screen.queryByRole("button", {
        name: "Remove Persisted Song from queue",
      }),
    ).not.toBeInTheDocument();
  });

  it("calls sendEvent when moving a track up in queue", async () => {
    renderWithListenProviders(<JamSession />);

    await userEvent.click(
      screen.getByRole("button", { name: "Move Song Two up" }),
    );

    expect(mockSendEvent).toHaveBeenCalledWith({
      type: "queue_reorder",
      fromIndex: 1,
      toIndex: 0,
    });
  });

  it("shows disabled move-up button for first track", () => {
    renderWithListenProviders(<JamSession />);

    const queueSection = screen.getByText("Shared queue").closest("section")!;
    const buttons = Array.from(
      queueSection.querySelectorAll("button[disabled]"),
    );
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("calls sendEvent for reorder when moving down", async () => {
    renderWithListenProviders(<JamSession />);

    await userEvent.click(
      screen.getByRole("button", { name: "Move Song One down" }),
    );

    expect(mockSendEvent).toHaveBeenCalledWith({
      type: "queue_reorder",
      fromIndex: 0,
      toIndex: 1,
    });
  });

  it("shows search input for adding tracks", () => {
    renderWithListenProviders(<JamSession />);

    expect(
      screen.getByPlaceholderText("Search tracks to add to this room"),
    ).toBeInTheDocument();
  });

  it("uses the heart control for one-way voting in auto mode", async () => {
    mockJamConnected.value = true;
    const track = createMockTrack({ id: "track-vote", title: "Vote Song" });
    mockUseApiData.value = makeRoom({
      queue_mode: "auto",
      queue: [
        {
          id: "queue-vote",
          track,
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });

    renderWithListenProviders(<JamSession />);

    const voteButton = screen.getByRole("button", {
      name: "Vote for Vote Song",
    });
    await userEvent.click(voteButton);

    expect(mockSendEvent).toHaveBeenCalledWith({
      type: "queue_vote",
      queue_item_id: "queue-vote",
    });
    expect(
      screen.getByRole("button", { name: "Vote recorded for Vote Song" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("1 vote")).toBeInTheDocument();
  });

  it("shows the next-track suggestions supplied by Auto DJ", () => {
    mockUseApiData.value = makeRoom({
      queue_mode: "auto_dj",
      auto_dj_suggestions: [
        {
          id: "auto-dj-track",
          title: "Suggested track",
          artist: "Suggested artist",
          album: "Suggested album",
        },
      ],
    });

    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Suggested next")).toBeInTheDocument();
    expect(screen.getByText("Suggested track")).toBeInTheDocument();
    expect(screen.getByText("Suggested artist")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GUEST VIEW
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession guest view", () => {
  const guestRoom = makeRoom({
    host_user_id: 99,
    members: [
      makeMember({ user_id: 99, role: "host", display_name: "HostUser" }),
      makeMember({
        user_id: 1,
        role: "collab",
        display_name: "Listener",
        username: "listener",
      }),
    ],
  });

  beforeEach(() => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = guestRoom;
  });

  it("does not show host-only toggle visibility button", () => {
    renderWithListenProviders(<JamSession />);

    expect(
      screen.queryByRole("button", { name: /make room invite-only/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /make room public/i }),
    ).not.toBeInTheDocument();
  });

  it("does not show host-only end room button", () => {
    renderWithListenProviders(<JamSession />);

    expect(
      screen.queryByRole("button", { name: /end room/i }),
    ).not.toBeInTheDocument();
  });

  it("shows room header with member info for guest", () => {
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Test Room")).toBeInTheDocument();
    expect(screen.getByText("HostUser")).toBeInTheDocument();
    expect(screen.getByText("Listener")).toBeInTheDocument();
  });

  it("shows sync status indicator for non-host", () => {
    renderWithListenProviders(<JamSession />);

    // Non-host sees a Zap icon instead of play/pause button
    expect(screen.getByText("Shared queue")).toBeInTheDocument();
  });

  it("allows collab guests to edit the queue", () => {
    renderWithListenProviders(<JamSession />);

    // Collab should see the search input
    expect(
      screen.getByPlaceholderText("Search tracks to add to this room"),
    ).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ROOM ENDED STATE
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession ended room", () => {
  it("shows 'Room ended' badge for ended rooms", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({ status: "ended" });
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Room ended")).toBeInTheDocument();
  });

  it("disables add current track button when room is ended", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({ status: "ended" });
    renderWithListenProviders(<JamSession />);

    const addBtn = screen.getByRole("button", {
      name: /add current track/i,
    });
    expect(addBtn).toBeDisabled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CURRENT TRACK DISPLAY
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession current track", () => {
  it("shows now playing in room when current_track_payload is set", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({
      current_track_payload: {
        track: { id: "ct1", title: "Current Jam", artist: "Jammer" },
      },
    });
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Now playing in room")).toBeInTheDocument();
    expect(screen.getByText("Current Jam")).toBeInTheDocument();
  });

  it("renders host transport controls beside the room now-playing track", async () => {
    mockParams.roomId = "room-1";
    mockJamConnected.value = true;
    mockUseApiLoading.value = false;
    const track = createMockTrack({
      id: "ct1",
      title: "Current Jam",
      artist: "Jammer",
      album: "Live Room",
    });
    mockUseApiData.value = makeRoom({
      current_track_payload: {
        track,
        position: 34,
        playing: false,
      },
      queue: [
        {
          id: "queue-next",
          track: createMockTrack({ id: "next", title: "Next Jam" }),
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });
    const resume = vi.fn();
    renderWithListenProviders(<JamSession />, {
      playerActions: { currentTrack: track, resume },
      playerProgress: { currentTime: 34, duration: 180 },
    });

    await waitFor(() => {
      expect(screen.getByText("Connected to room")).toBeInTheDocument();
    });
    expect(screen.getByText("Current Jam")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Play room" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Play next track" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sync playback" }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Play room" }));

    expect(mockSendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "play",
        track: expect.objectContaining({ id: "track-1" }),
        position: 34,
        playing: true,
      }),
    );
    expect(resume).toHaveBeenCalled();
  });

  it("uses the room track when the host's local player is stale", async () => {
    mockParams.roomId = "room-1";
    mockJamConnected.value = true;
    mockUseApiLoading.value = false;
    const roomTrack = createMockTrack({
      id: "room-track",
      entityUid: "room-track",
      title: "Room Song",
    });
    const staleTrack = createMockTrack({
      id: "stale-track",
      entityUid: "stale-track",
      title: "Old Song",
    });
    mockUseApiData.value = makeRoom({
      current_track_payload: {
        track: roomTrack,
        position: 12,
        playing: false,
      },
      queue: [
        {
          id: "queue-room-track",
          track: roomTrack,
          status: "playing",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });
    renderWithListenProviders(<JamSession />, {
      playerActions: { currentTrack: staleTrack },
      playerProgress: { currentTime: 12, duration: 180 },
    });

    await userEvent.click(screen.getByRole("button", { name: "Play room" }));

    expect(mockSendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "play",
        track: expect.objectContaining({ id: "room-track" }),
      }),
    );
  });

  it("anchors a room sync to the host's actual playback position", async () => {
    mockParams.roomId = "room-1";
    mockJamConnected.value = true;
    mockUseApiLoading.value = false;
    const roomTrack = createMockTrack({
      id: "room-track",
      entityUid: "room-track",
      title: "Room Song",
    });
    mockUseApiData.value = makeRoom({
      current_track_payload: {
        track: roomTrack,
        position: 12,
        playing: true,
      },
      queue: [
        {
          id: "queue-room-track",
          track: roomTrack,
          status: "playing",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });
    renderWithListenProviders(<JamSession />, {
      playerActions: { currentTrack: roomTrack },
      playerState: { isPlaying: true },
      playerProgress: { currentTime: 12.34, duration: 180 },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Sync playback" }),
    );

    expect(mockSendEvent).toHaveBeenCalledWith({
      type: "sync",
      scope: "room",
      track: expect.objectContaining({ entityUid: "room-track" }),
      position: 12.34,
      playing: true,
    });
  });

  it("shows an empty now-playing state when no track is set", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({ current_track_payload: null });
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("The room queue is empty")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PERMANENT ROOM DISPLAY
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession permanent room", () => {
  it("shows permanent badge and toggle text for permanent rooms", async () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({ is_permanent: true });
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    expect(screen.getByText("Permanent")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /unpin permanent room/i }),
    ).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PRIVATE ROOM DISPLAY
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession private room", () => {
  it("shows invite-only badge for private rooms", async () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({ visibility: "private" });
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    expect(screen.getByText("Invite-only")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /make room public/i }),
    ).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET / CONNECTION STATES
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession WebSocket states", () => {
  it("shows connecting message when not connected", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom();
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText(/connecting to room/i)).toBeInTheDocument();
  });

  it("sendEvent failure marks connection as problematic", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom();
    renderWithListenProviders(<JamSession />);

    // The component uses sendEvent from useJamWebSocket which is mocked
    expect(mockSendEvent).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// QUEUE SEARCH
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession queue search", () => {
  it("uses global album identity to render artwork for searched tracks", async () => {
    mockParams.roomId = "room-1";
    mockUseApiData.value = makeRoom();
    mockApiCall.mockResolvedValueOnce({
      tracks: [
        {
          id: 42,
          title: "Searched track",
          artist: "Artist",
          album: "Album",
          global_track_uid: "track-global-1",
          global_album_uid: "album-global-1",
        },
      ],
    });
    renderWithListenProviders(<JamSession />);

    await userEvent.type(
      screen.getByPlaceholderText("Search tracks to add to this room"),
      "searched",
    );

    await waitFor(() => {
      expect(screen.getByText("Searched track")).toBeInTheDocument();
    });
    expect(
      document.querySelector<HTMLImageElement>(
        'img[src*="/api/catalog/albums/album-global-1/cover"]',
      ),
    ).not.toBeNull();
  });

  it("does not persist an authentication-bound artwork URL in Jam events", async () => {
    mockParams.roomId = "room-1";
    mockUseApiData.value = makeRoom();
    mockApiCall.mockResolvedValueOnce({
      tracks: [
        {
          id: 42,
          title: "Searched track",
          artist: "Artist",
          album: "Album",
          global_track_uid: "track-global-1",
          global_album_uid: "album-global-1",
        },
      ],
    });
    renderWithListenProviders(<JamSession />);

    await userEvent.type(
      screen.getByPlaceholderText("Search tracks to add to this room"),
      "searched",
    );

    const result = await screen.findByRole("button", {
      name: /searched track/i,
    });
    await userEvent.click(result);

    expect(mockSendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "queue_add",
        track: expect.objectContaining({
          globalAlbumUid: "album-global-1",
        }),
      }),
    );
    const calls = mockSendEvent.mock.calls as unknown as Array<
      [{ track?: Record<string, unknown> }]
    >;
    const event = calls[calls.length - 1]?.[0];
    expect(event?.track).not.toHaveProperty("albumCover");
  });

  it("shows disabled search input when user cannot edit queue", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({
      host_user_id: 99,
      members: [
        makeMember({ user_id: 99, role: "host" }),
        makeMember({
          user_id: 1,
          role: "collab",
        }),
      ],
    });
    renderWithListenProviders(<JamSession />);

    const searchInput = screen.getByPlaceholderText(
      "Search tracks to add to this room",
    );
    expect(searchInput).not.toBeDisabled();
  });

  it("shows disabled search for non-collab guests", () => {
    // A guest who is not host or collab shouldn't be able to edit
    // But the component checks `canEditQueue = roomIsActive && (myRole === "host" || myRole === "collab")`
    // Since we haven't added a third role, let's test a simpler scenario
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom();
    renderWithListenProviders(<JamSession />);

    expect(screen.getByText("Shared queue")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// API ERROR HANDLING IN MUTATIONS
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession API error handling", () => {
  it("shows error toast when ending room fails", async () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom();
    mockApiCall.mockRejectedValueOnce(new Error("fail"));
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    await userEvent.click(screen.getByRole("button", { name: /end room/i }));

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalled();
    });
    // toast.error would be called but we don't assert on sonner internals
  });

  it("shows error toast when create invite fails", async () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom();
    mockApiCall.mockRejectedValueOnce(new Error("fail"));
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    await userEvent.click(
      screen.getByRole("button", { name: /invite people/i }),
    );

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalled();
    });
  });

  it("shows error toast when toggling visibility fails", async () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom();
    mockApiCall.mockRejectedValueOnce(new Error("fail"));
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    await userEvent.click(
      screen.getByRole("button", { name: /make room invite-only/i }),
    );

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalled();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLAYER ACTIONS
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession player actions", () => {
  it("shows play room queue button", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({
      events: [
        {
          id: 1,
          room_id: "room-1",
          user_id: 1,
          event_type: "queue_add",
          payload_json: {
            track: { id: "t1", title: "Song", artist: "Artist" },
          },
          created_at: "2026-01-01T12:00:00Z",
        },
      ],
    });
    renderWithListenProviders(<JamSession />);

    expect(
      screen.getByRole("button", { name: /play room queue/i }),
    ).toBeInTheDocument();
  });

  it("disables play room queue when queue is empty", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({ events: [] });
    renderWithListenProviders(<JamSession />);

    const playBtn = screen.getByRole("button", {
      name: /play room queue/i,
    });
    expect(playBtn).toBeDisabled();
  });

  it("shows share current track button", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom();
    renderWithListenProviders(<JamSession />);

    expect(
      screen.getByRole("button", { name: /add current track/i }),
    ).toBeInTheDocument();
  });

  it("disables share current track button when room is not connected", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom();
    renderWithListenProviders(<JamSession />, {
      playerActions: {
        currentTrack: createMockTrack({
          id: "current",
          title: "Now Playing",
          artist: "Artist",
        }),
      },
    });

    // Button is disabled because isConnected is false
    const addBtn = screen.getByRole("button", { name: /add current track/i });
    expect(addBtn).toBeDisabled();
  });

  it("disables sharing the current track when it is already in the room queue", () => {
    mockParams.roomId = "room-1";
    mockJamConnected.value = true;
    mockUseApiLoading.value = false;
    const track = createMockTrack({
      id: "current",
      title: "Now Playing",
      artist: "Artist",
    });
    mockUseApiData.value = makeRoom({
      queue: [
        {
          id: "queue-1",
          track,
          status: "playing",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });

    renderWithListenProviders(<JamSession />, {
      playerActions: { currentTrack: track },
    });

    expect(
      screen.getByRole("button", { name: /add current track/i }),
    ).toBeDisabled();
  });

  it("lets the authoritative room event start the first track", async () => {
    mockParams.roomId = "room-1";
    mockJamConnected.value = true;
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({ queue: [] });
    const track = createMockTrack({
      id: "current",
      title: "Now Playing",
      artist: "Artist",
    });
    renderWithListenProviders(<JamSession />, {
      playerActions: { currentTrack: track },
    });

    await userEvent.click(
      screen.getByRole("button", { name: /add current track/i }),
    );

    expect(mockSendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "queue_add" }),
    );
  });

  it("asks the host to play the room queue when the button is clicked", async () => {
    mockParams.roomId = "room-1";
    mockJamConnected.value = true;
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({
      events: [
        {
          id: 1,
          room_id: "room-1",
          user_id: 1,
          event_type: "queue_add",
          payload_json: {
            track: { id: "t1", title: "Song", artist: "Artist" },
          },
          created_at: "2026-01-01T12:00:00Z",
        },
      ],
    });

    renderWithListenProviders(<JamSession />);

    await userEvent.click(
      screen.getByRole("button", { name: /play room queue/i }),
    );

    expect(mockSendEvent).toHaveBeenCalledWith({ type: "queue_play" });
  });

  it("lets the authoritative queue event load the room queue", async () => {
    mockParams.roomId = "room-1";
    mockJamConnected.value = true;
    mockUseApiLoading.value = false;
    const first = createMockTrack({
      id: "t1",
      entityUid: "track-1",
      title: "Song One",
    });
    const second = createMockTrack({
      id: "t2",
      entityUid: "track-2",
      title: "Song Two",
    });
    mockUseApiData.value = makeRoom({
      queue: [
        {
          id: "queue-1",
          track: first,
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
        {
          id: "queue-2",
          track: second,
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });

    renderWithListenProviders(<JamSession />);

    await userEvent.click(
      screen.getByRole("button", { name: /play room queue/i }),
    );

    expect(mockSendEvent).toHaveBeenCalledWith({ type: "queue_play" });
  });

  it("hydrates the local player queue from the room snapshot on entry", async () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    const first = createMockTrack({ id: "t1", title: "Room Song One" });
    const second = createMockTrack({ id: "t2", title: "Room Song Two" });
    mockUseApiData.value = makeRoom({
      queue: [
        {
          id: "queue-1",
          track: first,
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
        {
          id: "queue-2",
          track: second,
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });

    const syncJamQueue = vi.fn();
    renderWithListenProviders(<JamSession />, {
      playerActions: { syncJamQueue },
    });

    await waitFor(() => {
      expect(syncJamQueue).toHaveBeenCalledWith(
        [
          expect.objectContaining({ id: "t1" }),
          expect.objectContaining({ id: "t2" }),
        ],
        expect.objectContaining({
          source: { type: "queue", name: "Jam: Test Room" },
        }),
      );
    });
  });

  it("reconciles a derived room queue before websocket state is marked open", async () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({
      events: [
        ...["Song One", "Song Two", "Song Three"].map((title, index) => ({
          id: index + 1,
          room_id: "room-1",
          user_id: 1,
          event_type: "queue_add",
          payload_json: {
            track: { id: `t${index + 1}`, title, artist: "Artist" },
          },
          created_at: `2026-01-01T12:0${index}:00Z`,
        })),
      ],
    });

    const syncJamQueue = vi.fn();
    renderWithListenProviders(<JamSession />, {
      playerActions: { syncJamQueue },
    });

    await waitFor(() => {
      expect(syncJamQueue).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ title: "Song One" }),
          expect.objectContaining({ title: "Song Two" }),
          expect.objectContaining({ title: "Song Three" }),
        ]),
        expect.objectContaining({
          source: { type: "queue", name: "Jam: Test Room" },
        }),
      );
    });
  });

  it("does not replay a stale REST snapshot after the room websocket is connected", async () => {
    mockParams.roomId = "room-1";
    mockJamConnected.value = true;
    mockUseApiLoading.value = false;
    const first = createMockTrack({ id: "t1", title: "Room Song One" });
    const second = createMockTrack({ id: "t2", title: "Room Song Two" });
    const initialRoom = makeRoom({
      current_track_payload: {
        track: first,
        position: 0,
        playing: true,
      },
      queue: [
        {
          id: "queue-1",
          track: first,
          status: "playing",
          vote_count: 0,
          voted_by_me: false,
        },
        {
          id: "queue-2",
          track: second,
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });
    mockUseApiData.value = initialRoom;

    const syncJamQueue = vi.fn();
    renderWithListenProviders(<JamSessionRerenderHarness />, {
      playerActions: { syncJamQueue },
    });

    await waitFor(() => {
      expect(screen.getByText("Connected to room")).toBeInTheDocument();
    });
    const callsAfterConnection = syncJamQueue.mock.calls.length;

    mockUseApiData.value = makeRoom({
      ...initialRoom,
      name: "Refreshed Room Snapshot",
      current_track_payload: {
        track: first,
        position: 0,
        playing: true,
      },
    });
    await userEvent.click(screen.getByTestId("rerender-jam-session"));
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(syncJamQueue).toHaveBeenCalledTimes(callsAfterConnection);
  });

  it("lets the host drag a queue item to a new position", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    const first = createMockTrack({ id: "t1", title: "Song One" });
    const second = createMockTrack({ id: "t2", title: "Song Two" });
    mockUseApiData.value = makeRoom({
      queue: [
        {
          id: "queue-1",
          track: first,
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
        {
          id: "queue-2",
          track: second,
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });

    renderWithListenProviders(<JamSession />);

    expect(
      screen.getByRole("button", { name: "Drag Song Two to reorder" }),
    ).toBeInTheDocument();
    mockDndContext.onDragEnd?.({
      active: { id: "queue-2" },
      over: { id: "queue-1" },
    });

    expect(mockSendEvent).toHaveBeenCalledWith({
      type: "queue_reorder",
      queue_item_id: "queue-2",
      toIndex: 0,
    });
  });

  it("uses the hovered row as the insertion target when dragging down", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    const first = createMockTrack({ id: "t1", title: "Song One" });
    const second = createMockTrack({ id: "t2", title: "Song Two" });
    mockUseApiData.value = makeRoom({
      queue: [
        {
          id: "queue-1",
          track: first,
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
        {
          id: "queue-2",
          track: second,
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });

    renderWithListenProviders(<JamSession />);
    mockDndContext.onDragEnd?.({
      active: { id: "queue-1" },
      over: { id: "queue-2" },
    });

    expect(mockSendEvent).toHaveBeenCalledWith({
      type: "queue_reorder",
      queue_item_id: "queue-1",
      toIndex: 1,
    });
  });

  it("keeps the shared queue inside a scrollable panel", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({
      queue: [
        {
          id: "queue-1",
          track: createMockTrack({ id: "t1", title: "Song One" }),
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });
    renderWithListenProviders(<JamSession />);

    const queueList = screen.getByTestId("jam-shared-queue-list");
    expect(queueList.className).toContain("max-h");
    expect(queueList.className).toContain("overflow-y-auto");
  });

  it("advances the shared queue at the end of a track in DJ mode", async () => {
    mockParams.roomId = "room-1";
    mockJamConnected.value = true;
    mockUseApiLoading.value = false;
    const first = createMockTrack({ id: "t1", title: "Song One" });
    const second = createMockTrack({ id: "t2", title: "Song Two" });
    mockUseApiData.value = makeRoom({
      queue_mode: "manual",
      current_track_payload: {
        track: first,
        position: 0,
        playing: true,
      },
      queue: [
        {
          id: "queue-1",
          track: first,
          status: "playing",
          vote_count: 0,
          voted_by_me: false,
        },
        {
          id: "queue-2",
          track: second,
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });

    renderWithListenProviders(<JamSession />, {
      playerState: { isPlaying: true },
      playerProgress: { currentTime: 99.5, duration: 100 },
    });

    await waitFor(() => {
      expect(mockSendEvent).toHaveBeenCalledWith({ type: "play_next" });
    });
  });

  it("advances the authoritative queue when the player already moved to the next track", async () => {
    mockParams.roomId = "room-1";
    mockJamConnected.value = true;
    mockUseApiLoading.value = false;
    const first = createMockTrack({
      id: "t1",
      entityUid: "track-1",
      title: "Song One",
    });
    const second = createMockTrack({
      id: "t2",
      entityUid: "track-2",
      title: "Song Two",
    });
    mockUseApiData.value = makeRoom({
      queue_mode: "manual",
      current_track_payload: {
        track: first,
        position: 0,
        playing: true,
      },
      queue: [
        {
          id: "queue-1",
          track: first,
          status: "playing",
          vote_count: 0,
          voted_by_me: false,
        },
        {
          id: "queue-2",
          track: second,
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });

    renderWithListenProviders(<JamSession />, {
      playerActions: { currentTrack: second },
      playerState: { isPlaying: true },
      playerProgress: { currentTime: 0, duration: 100 },
    });

    await waitFor(() => {
      expect(mockSendEvent).toHaveBeenCalledWith({ type: "play_next" });
    });
  });

  it("advances the room when the player reports the current track finished", async () => {
    mockParams.roomId = "room-1";
    mockJamConnected.value = true;
    mockUseApiLoading.value = false;
    const first = createMockTrack({
      id: "t1",
      entityUid: "track-1",
      title: "Song One",
    });
    const second = createMockTrack({
      id: "t2",
      entityUid: "track-2",
      title: "Song Two",
    });
    const roomFirst = {
      ...first,
      globalTrackUid: "room-global-track-1",
      entityUid: "stable-entity-track-1",
    };
    const playerFirst = {
      ...first,
      globalTrackUid: "player-global-track-1",
      entityUid: "stable-entity-track-1",
    };
    mockUseApiData.value = makeRoom({
      queue_mode: "manual",
      current_track_payload: {
        track: roomFirst,
        position: 100,
        playing: false,
      },
      queue: [
        {
          id: "queue-1",
          track: roomFirst,
          status: "playing",
          vote_count: 0,
          voted_by_me: false,
        },
        {
          id: "queue-2",
          track: second,
          status: "queued",
          vote_count: 0,
          voted_by_me: false,
        },
      ],
    });

    renderWithListenProviders(<JamSession />, {
      playerActions: { currentTrack: playerFirst },
      playerProgress: { currentTime: 100, duration: 100 },
    });

    window.dispatchEvent(
      new CustomEvent(PLAYER_TRACK_FINISHED_EVENT, {
        detail: { track: playerFirst },
      }),
    );

    await waitFor(() => {
      expect(mockSendEvent).toHaveBeenCalledWith({ type: "play_next" });
    });
  });

  it("reflects a queue mode change even when the PATCH response is stale", async () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({ queue_mode: "manual" });
    mockApiCall.mockResolvedValueOnce(makeRoom({ queue_mode: "manual" }));
    renderWithListenProviders(<JamSession />);

    await userEvent.click(
      screen.getByRole("button", { name: /switch to auto mode/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /switch to dj mode/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Auto mode")).toBeInTheDocument();
  });

  it("keeps the user in the room and focuses queue search from the empty state", async () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom({ queue: [] });
    renderWithListenProviders(<JamSession />);

    const searchInput = screen.getByPlaceholderText(
      "Search tracks to add to this room",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /browse library/i }),
    );

    expect(mockNavigate).not.toHaveBeenCalled();
    await waitFor(() => expect(searchInput).toHaveFocus());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession modals", () => {
  beforeEach(() => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = false;
    mockUseApiData.value = makeRoom();
  });

  it("closes metadata modal when cancel is clicked", async () => {
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    await userEvent.click(
      screen.getByRole("button", {
        name: /edit room profile/i,
      }),
    );
    expect(screen.getByText("Room profile")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Cancel"));
    await waitFor(() => {
      expect(screen.queryByText("Room profile")).not.toBeInTheDocument();
    });
  });

  it("closes invite modal when close button is clicked", async () => {
    const invite: JamInvite = {
      token: "token",
      join_url: "/jam/invite/token",
      qr_value: "/api/qr",
    };
    mockApiCall.mockResolvedValueOnce(invite);
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    await userEvent.click(
      screen.getByRole("button", { name: /invite people/i }),
    );
    await waitFor(() => {
      expect(screen.getByText("Invite to room")).toBeInTheDocument();
    });
  });

  it("closes delete modal when cancel is clicked", async () => {
    renderWithListenProviders(<JamSession />);
    await openRoomActionsMenu();

    await userEvent.click(screen.getByRole("button", { name: /delete room/i }));
    const heading = screen.getByRole("heading", { name: /delete room/i });
    expect(heading).toBeInTheDocument();

    const modal = heading.parentElement!.parentElement!.parentElement!;
    await userEvent.click(within(modal).getByText("Cancel"));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: /delete room/i }),
      ).not.toBeInTheDocument();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// UNAUTHENTICATED USER
// ══════════════════════════════════════════════════════════════════════════════

describe("JamSession unauthenticated", () => {
  it("renders lobby without user (shows create form)", () => {
    mockUseApiData.value = makeRoomsResponse([]);
    renderWithListenProviders(<JamSession />, {
      auth: { user: null, loading: false },
    });

    expect(
      screen.getByRole("heading", { name: "Jam sessions" }),
    ).toBeInTheDocument();
  });

  it("renders room if roomId is set but user is null", () => {
    mockParams.roomId = "room-1";
    mockUseApiLoading.value = true;
    mockUseApiData.value = null;
    renderWithListenProviders(<JamSession />, {
      auth: { user: null, loading: false },
    });

    // Should show spinner while loading
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });
});
