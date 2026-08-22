import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useApiMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: useApiMock,
}));

vi.mock("leaflet", () => ({
  divIcon: (options: unknown) => options,
  latLngBounds: () => ({}),
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map">{children}</div>
  ),
  TileLayer: () => null,
  Marker: ({
    children,
    eventHandlers,
    title,
  }: {
    children?: React.ReactNode;
    eventHandlers?: { click?: () => void };
    title?: string;
  }) => (
    <button type="button" aria-label={title} onClick={eventHandlers?.click}>
      {children}
    </button>
  ),
  useMap: () => ({
    fitBounds: vi.fn(),
    setView: vi.fn(),
  }),
}));

import { UserMap, groupMapUsers, type MapUser } from "./UserMap";

const users: MapUser[] = [
  {
    id: 1,
    name: "First",
    email: "first@example.com",
    avatar: null,
    city: "Madrid",
    country: "Spain",
    latitude: 40.4168,
    longitude: -3.7038,
    online: true,
    now_playing: { title: "Track", artist: "Artist", album: "Album" },
    activity_status: "active",
    last_activity_at: "2026-08-21T11:59:00Z",
  },
  {
    id: 2,
    name: "Second",
    email: "second@example.com",
    avatar: null,
    city: "Madrid",
    country: "Spain",
    latitude: 40.4168,
    longitude: -3.7038,
    online: false,
    now_playing: null,
    activity_status: "inactive",
    last_activity_at: "2026-07-01T11:59:00Z",
  },
];

describe("UserMap", () => {
  beforeEach(() => {
    useApiMock.mockReset();
  });

  it("groups users sharing a coordinate without dropping either user", () => {
    const groups = groupMapUsers(users);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.users.map((user) => user.id)).toEqual([1, 2]);
  });

  it("opens the user overlay and allows inspecting a user in a group", async () => {
    const inspectUser = vi.fn();
    useApiMock.mockReturnValue({ data: { users }, loading: false });
    const user = userEvent.setup();

    render(<UserMap onInspectUser={inspectUser} />);

    await user.click(
      screen.getByRole("button", { name: "2 users at Madrid, Spain" }),
    );

    expect(screen.getByText("2 users at this location")).toBeInTheDocument();
    expect(screen.getAllByText("first@example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText("second@example.com").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /Second/ }));
    await user.click(screen.getByRole("button", { name: "Inspect user" }));

    await waitFor(() => {
      expect(inspectUser).toHaveBeenCalledWith(users[1]);
    });
  });
});
