import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const { apiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 999 },
    hasCapability: () => true,
  }),
}));

vi.mock("@/components/users/UserMap", () => ({
  UserMap: () => <div data-testid="user-map" />,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { Users } from "./Users";

const users = Array.from({ length: 21 }, (_, index) => {
  const id = index + 1;
  const inactive = id === 21;
  return {
    id,
    email: `user-${id}@example.com`,
    name: `User ${id}`,
    avatar: null,
    role: "user",
    roles: ["user"],
    status: "active",
    connected_accounts: [],
    online_now: false,
    listening_now: false,
    active_devices: 0,
    active_sessions: 0,
    current_track: null,
    last_played_at: null,
    last_seen_at: null,
    last_login: inactive ? "2026-01-01T00:00:00Z" : "2026-08-20T00:00:00Z",
    created_at: "2025-01-01T00:00:00Z",
    last_activity_at: inactive
      ? "2026-01-01T00:00:00Z"
      : "2026-08-20T00:00:00Z",
    activity_status: inactive ? "inactive" : "active",
  };
});

describe("Users", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/auth/users") return Promise.resolve(users);
      return Promise.resolve({});
    });
  });

  it("labels and filters inactive users without changing account status", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Showing 1-20 of 21 users"),
    ).toBeInTheDocument();
    expect(screen.getByText("Inactive 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Inactive 1" }));

    expect(screen.getByText("Showing 1-1 of 1 users")).toBeInTheDocument();
    expect(screen.getByText("user-21@example.com")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("paginates the rendered users", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Showing 1-20 of 21 users"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(screen.getByText("Showing 21-21 of 21 users")).toBeInTheDocument();
    expect(screen.getByText("user-21@example.com")).toBeInTheDocument();
  });
});
