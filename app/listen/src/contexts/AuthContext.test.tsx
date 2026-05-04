import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiMock,
  clearQueueMock,
  consumePendingOAuthNextMock,
  navigateMock,
  primeOfflineRuntimeProfileMock,
  setActiveOfflineProfileKeyMock,
  setAuthTokenMock,
  syncOfflineProfileToServiceWorkerMock,
} = vi.hoisted(() => ({
  apiMock: vi.fn(),
  clearQueueMock: vi.fn(),
  consumePendingOAuthNextMock: vi.fn<() => string | null>(() => null),
  navigateMock: vi.fn(),
  primeOfflineRuntimeProfileMock: vi.fn(),
  setActiveOfflineProfileKeyMock: vi.fn(),
  setAuthTokenMock: vi.fn(),
  syncOfflineProfileToServiceWorkerMock: vi.fn(),
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/lib/api", () => ({
  api: apiMock,
  setAuthToken: setAuthTokenMock,
}));

vi.mock("@/lib/capacitor", () => ({
  consumePendingOAuthNext: consumePendingOAuthNextMock,
}));

vi.mock("@/lib/offline", () => ({
  primeOfflineRuntimeProfile: primeOfflineRuntimeProfileMock,
  setActiveOfflineProfileKey: setActiveOfflineProfileKeyMock,
  syncOfflineProfileToServiceWorker: syncOfflineProfileToServiceWorkerMock,
}));

vi.mock("@/lib/play-event-queue", () => ({
  clearQueue: clearQueueMock,
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

function AuthProbe() {
  const { user, loading, logout } = useAuth();
  return (
    <div>
      <div>{loading ? "loading" : user ? `user:${user.id}` : "anon"}</div>
      <button onClick={() => void logout()}>logout</button>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    apiMock.mockReset();
    clearQueueMock.mockReset();
    consumePendingOAuthNextMock.mockReset();
    consumePendingOAuthNextMock.mockReturnValue(null);
    navigateMock.mockReset();
    primeOfflineRuntimeProfileMock.mockReset();
    setActiveOfflineProfileKeyMock.mockReset();
    setAuthTokenMock.mockReset();
    syncOfflineProfileToServiceWorkerMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("hydrates the session on boot and primes the offline profile", async () => {
    apiMock.mockResolvedValueOnce({
      id: 7,
      email: "listener@example.test",
      name: "Listener",
      role: "user",
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("user:7")).toBeTruthy();
    expect(localStorage.getItem("listen-auth-user-id")).toBe("7");
    expect(primeOfflineRuntimeProfileMock).toHaveBeenCalledTimes(1);
  });

  it("clears derived runtime state when boot hydration ends unauthenticated", async () => {
    apiMock.mockResolvedValueOnce(null);

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("anon")).toBeTruthy();
    expect(setActiveOfflineProfileKeyMock).toHaveBeenCalledWith(null);
    expect(syncOfflineProfileToServiceWorkerMock).toHaveBeenCalledWith(null);
  });

  it("drops previous playback state when the hydrated user changes", async () => {
    localStorage.setItem("listen-auth-user-id", "41");
    localStorage.setItem("listen-player-state", "{\"queue\":[]}");
    localStorage.setItem("listen-recently-played", "[]");
    apiMock.mockResolvedValueOnce({
      id: 42,
      email: "new@example.test",
      name: "New",
      role: "user",
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("user:42")).toBeTruthy();
    expect(localStorage.getItem("listen-player-state")).toBeNull();
    expect(localStorage.getItem("listen-recently-played")).toBeNull();
    expect(clearQueueMock).toHaveBeenCalledTimes(1);
  });

  it("cleans session state and navigates to login on logout", async () => {
    apiMock
      .mockResolvedValueOnce({
        id: 11,
        email: "logout@example.test",
        name: "Logout",
        role: "user",
      })
      .mockResolvedValueOnce({});

    localStorage.setItem("listen-player-state", "{\"queue\":[]}");
    localStorage.setItem("listen-recently-played", "[]");

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("user:11")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "logout" }));

    await waitFor(() => {
      expect(setAuthTokenMock).toHaveBeenCalledWith(null);
    });
    expect(localStorage.getItem("listen-player-state")).toBeNull();
    expect(localStorage.getItem("listen-recently-played")).toBeNull();
    expect(localStorage.getItem("listen-auth-user-id")).toBeNull();
    expect(clearQueueMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith("/login");
  });

  it("rehydrates and navigates when the native OAuth event arrives", async () => {
    apiMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 9,
        email: "oauth@example.test",
        name: "OAuth",
        role: "user",
      });

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("anon")).toBeTruthy();

    consumePendingOAuthNextMock.mockReturnValueOnce("/stats");
    window.dispatchEvent(new CustomEvent("crate:auth-token-received"));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/stats", { replace: true });
    });
    expect(apiMock.mock.calls.some(([url]) => url === "/api/auth/me")).toBe(true);
  });
});
