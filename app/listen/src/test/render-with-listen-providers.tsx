import { render, type RenderOptions } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ReactElement, ReactNode } from "react";

import {
  AuthContext,
  type AuthContextValue,
  type AuthUser,
} from "@/contexts/auth-context";
import {
  OfflineContext,
  type OfflineContextValue,
} from "@/contexts/offline-context";
import {
  PlayerActionsContext,
  PlayerStateContext,
  type PlayerActionsValue,
  type PlayerStateValue,
} from "@/contexts/player-context";
import type { Track } from "@/contexts/player-types";
import type { OfflineItemState } from "@/lib/offline";
import { SERVER_STORE_EVENT, type ServerConfig } from "@/lib/server-store";

export interface ListenRenderOptions extends Omit<RenderOptions, "wrapper"> {
  auth?: Partial<AuthContextValue>;
  offline?: Partial<OfflineContextValue>;
  playerActions?: Partial<PlayerActionsValue>;
  playerState?: Partial<PlayerStateValue>;
  path?: string;
  route?: string;
}

export function createMockAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 1,
    email: "listener@example.test",
    name: "Listener",
    role: "user",
    ...overrides,
  };
}

export function createMockAuthValue(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    user: createMockAuthUser(),
    loading: false,
    refetch: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    ...overrides,
  };
}

export function createMockPlayerState(
  overrides: Partial<PlayerStateValue> = {},
): PlayerStateValue {
  return {
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    isBuffering: false,
    volume: 0.8,
    analyserVersion: 0,
    crossfadeTransition: null,
    ...overrides,
  };
}

export function createMockPlayerActions(
  overrides: Partial<PlayerActionsValue> = {},
): PlayerActionsValue {
  const currentTrack = overrides.currentTrack;
  return {
    queue: currentTrack ? [currentTrack] : [],
    currentIndex: 0,
    shuffle: false,
    repeat: "off",
    playSource: null,
    recentlyPlayed: [],
    currentTrack,
    play: vi.fn(),
    playAll: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    clearQueue: vi.fn(),
    toggleShuffle: vi.fn(),
    cycleRepeat: vi.fn(),
    jumpTo: vi.fn(),
    playNext: vi.fn(),
    addToQueue: vi.fn(),
    removeFromQueue: vi.fn(),
    reorderQueue: vi.fn(),
    ...overrides,
  };
}

export function createMockOfflineValue(
  overrides: Partial<OfflineContextValue> = {},
): OfflineContextValue {
  const getIdleState = vi.fn<
    (value?: string | number | null) => OfflineItemState
  >(() => "idle");
  const toggleOffline = vi.fn<
    () => Promise<"enabled" | "removed">
  >(async () => "enabled");
  return {
    supported: true,
    syncing: false,
    summary: {
      itemCount: 0,
      readyItemCount: 0,
      errorItemCount: 0,
      trackCount: 0,
      readyTrackCount: 0,
      totalBytes: 0,
    },
    getTrackState: getIdleState,
    getAlbumState: getIdleState,
    getPlaylistState: getIdleState,
    getAlbumRecord: vi.fn(() => null),
    getPlaylistRecord: vi.fn(() => null),
    isTrackOffline: vi.fn(() => false),
    isAlbumOffline: vi.fn(() => false),
    isPlaylistOffline: vi.fn(() => false),
    toggleTrackOffline: toggleOffline,
    toggleAlbumOffline: toggleOffline,
    togglePlaylistOffline: toggleOffline,
    syncAll: vi.fn(async () => {}),
    clearActiveProfile: vi.fn(async () => {}),
    ...overrides,
  };
}

export function createMockTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "storage-1",
    storageId: "storage-1",
    title: "Track One",
    artist: "Artist One",
    ...overrides,
  };
}

export function seedNativeServer(
  overrides: Partial<ServerConfig> = {},
): ServerConfig {
  const server: ServerConfig = {
    id: overrides.id ?? "srv-1",
    label: overrides.label ?? "crate.example.test",
    url: overrides.url ?? "https://crate.example.test",
    token: overrides.token ?? null,
  };
  localStorage.setItem("crate-servers", JSON.stringify([server]));
  localStorage.setItem("crate-current-server", server.id);
  window.dispatchEvent(new CustomEvent(SERVER_STORE_EVENT));
  return server;
}

export function clearNativeServers() {
  localStorage.removeItem("crate-servers");
  localStorage.removeItem("crate-current-server");
  window.dispatchEvent(new CustomEvent(SERVER_STORE_EVENT));
}

function withOptionalRoute(
  ui: ReactNode,
  path?: string,
) {
  if (!path) return ui;
  return (
    <Routes>
      <Route path={path} element={ui} />
    </Routes>
  );
}

export function renderWithListenProviders(
  ui: ReactElement,
  {
    auth,
    offline,
    playerActions,
    playerState,
    path,
    route = "/",
    ...renderOptions
  }: ListenRenderOptions = {},
) {
  const authValue = createMockAuthValue(auth);
  const playerStateValue = createMockPlayerState(playerState);
  const playerActionsValue = createMockPlayerActions(playerActions);
  const offlineValue = createMockOfflineValue(offline);

  return {
    authValue,
    playerStateValue,
    playerActionsValue,
    offlineValue,
    ...render(
      <MemoryRouter initialEntries={[route]}>
        <AuthContext.Provider value={authValue}>
          <PlayerStateContext.Provider value={playerStateValue}>
            <PlayerActionsContext.Provider value={playerActionsValue}>
              <OfflineContext.Provider value={offlineValue}>
                {withOptionalRoute(ui, path)}
              </OfflineContext.Provider>
            </PlayerActionsContext.Provider>
          </PlayerStateContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>,
      renderOptions,
    ),
  };
}
