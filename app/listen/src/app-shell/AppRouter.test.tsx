import { screen } from "@testing-library/react";
import { Outlet } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppRouter } from "@/app-shell/AppRouter";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const runtimeState = vi.hoisted(() => ({
  isNative: false,
  currentServer: {
    id: "srv-1",
    label: "Crate",
    url: "https://crate.example.test",
    token: null,
  } as { id: string; label: string; url: string; token: string | null } | null,
}));

vi.mock("@/app-shell/AppProviders", () => ({
  AppProviders: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/layout/Shell", () => ({
  Shell: () => (
    <div data-testid="shell">
      <Outlet />
    </div>
  ),
}));

vi.mock("@/pages/Home", () => ({
  Home: () => <div>Home page</div>,
}));

vi.mock("@/pages/Login", () => ({
  Login: () => <div>Login page</div>,
}));

vi.mock("@/pages/AuthCallback", () => ({
  AuthCallback: () => <div>Auth callback page</div>,
}));

vi.mock("@/pages/ServerSetup", () => ({
  ServerSetup: () => <div>Server setup page</div>,
}));

vi.mock("@/lib/cache", () => ({
  connectCacheEvents: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/capacitor", () => ({
  get isNative() {
    return runtimeState.isNative;
  },
}));

vi.mock("@/lib/server-store", () => ({
  SERVER_STORE_EVENT: "crate-server-store-change",
  getCurrentServer: () => runtimeState.currentServer,
  migrateLegacyToken: vi.fn(),
}));

describe("AppRouter", () => {
  beforeEach(() => {
    runtimeState.isNative = false;
    runtimeState.currentServer = {
      id: "srv-1",
      label: "Crate",
      url: "https://crate.example.test",
      token: null,
    };
  });

  it("sends unauthenticated users to login", async () => {
    renderWithListenProviders(<AppRouter />, {
      route: "/stats",
      auth: { user: null, loading: false },
    });

    expect(await screen.findByText("Login page")).toBeTruthy();
  });

  it("renders the shell and home route for authenticated users", async () => {
    renderWithListenProviders(<AppRouter />, {
      route: "/",
    });

    expect(await screen.findByTestId("shell")).toBeTruthy();
    expect(await screen.findByText("Home page")).toBeTruthy();
  });

  it("keeps the OAuth callback public so it does not bounce through auth guards", async () => {
    renderWithListenProviders(<AppRouter />, {
      route: "/auth/callback?token=oauth-token",
      auth: { user: null, loading: false },
    });

    expect(await screen.findByText("Auth callback page")).toBeTruthy();
    expect(screen.queryByText("Login page")).toBeNull();
  });

  it("redirects native clients without a configured server to setup", async () => {
    runtimeState.isNative = true;
    runtimeState.currentServer = null;

    renderWithListenProviders(<AppRouter />, {
      route: "/radio",
    });

    expect(await screen.findByText("Server setup page")).toBeTruthy();
  });
});
