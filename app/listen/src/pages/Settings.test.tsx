import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Settings } from "@/pages/Settings";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const { androidNativePlayerState } = vi.hoisted(() => ({
  androidNativePlayerState: { enabled: false },
}));

vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => androidNativePlayerState.enabled,
}));

vi.mock("@/components/settings/ServersSection", () => ({
  ServersSection: () => <section>Servers</section>,
}));

vi.mock("@/components/settings/ConnectDevicesSection", () => ({
  ConnectDevicesSection: () => <section>Connect devices</section>,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(async (url: string, method?: string, body?: unknown) => {
      if (url === "/api/bandcamp/me/status") {
        return {
          connected: false,
          status: "disconnected",
          bridge_enabled: false,
        };
      }
      if (url === "/api/me/scrobble/preferences") {
        if (method === "PUT") return body;
        return { remote_scrobbling_enabled: false };
      }
      return {};
    }),
  };
});

describe("Settings", () => {
  beforeEach(() => {
    localStorage.clear();
    androidNativePlayerState.enabled = false;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
  });

  it("localizes the settings page chrome", () => {
    const { container } = renderWithListenProviders(<Settings />, {
      locale: "es",
    });

    expect(
      screen.getByRole("heading", { name: "Ajustes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Reproducción")).toBeInTheDocument();
    expect(screen.getByText("Temporizador")).toBeInTheDocument();
    expect(screen.getByText("Idioma de la app")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Español/i })).toBeInTheDocument();
    expect(screen.getByText("1 h")).toBeInTheDocument();
    expect(screen.getByText("Al terminar la pista")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("tu-handle")).toBeInTheDocument();
    expect(screen.getByText("Enlaces rápidos")).toBeInTheDocument();
    expect(container.querySelector(".settings-header")).toBeInTheDocument();
    expect(container.querySelector(".settings-section")).toBeInTheDocument();
  });

  it("changes and stores the selected Listen language", async () => {
    const user = userEvent.setup();

    renderWithListenProviders(<Settings />, { locale: "en" });

    expect(screen.getByText("App language")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Español/i }));

    expect(localStorage.getItem("crate-listen-locale")).toBe("es");
    expect(
      await screen.findByRole("heading", { name: "Ajustes" }),
    ).toBeInTheDocument();
  });

  it("lets the user opt into automatic stream quality", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<Settings />, { locale: "en" });

    const auto = screen.getByRole("radio", { name: /Auto \(recommended\)/i });
    expect(auto).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("radio", { name: /^Original/i }));
    expect(localStorage.getItem("listen-player-delivery-policy")).toBe(
      "original",
    );

    await user.click(auto);
    expect(localStorage.getItem("listen-player-delivery-policy")).toBe("auto");
  });

  it("hides crossfade controls on mobile", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });

    renderWithListenProviders(<Settings />, { locale: "en" });

    expect(screen.queryByText("Crossfade")).not.toBeInTheDocument();
    expect(screen.queryByText("Smart transitions")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Enhanced mobile audio (EQ)"),
    ).not.toBeInTheDocument();
  });

  it("shows the native equalizer toggle on Android and defaults it on", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    androidNativePlayerState.enabled = true;
    const user = userEvent.setup();

    renderWithListenProviders(<Settings />, { locale: "en" });

    const toggle = screen.getByRole("button", { name: "Equalizer" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.click(toggle);
    expect(localStorage.getItem("listen-eq-enabled")).toBe("false");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps crossfade controls on desktop", () => {
    renderWithListenProviders(<Settings />, { locale: "en" });

    expect(screen.getByText("Crossfade")).toBeInTheDocument();
    expect(screen.getByText("Smart transitions")).toBeInTheDocument();
  });

  it("keeps remote scrobbling opt-in and persists an explicit toggle", async () => {
    const user = userEvent.setup();
    const { api } = await import("@/lib/api");

    renderWithListenProviders(<Settings />, { locale: "en" });

    const toggle = await screen.findByRole("button", {
      name: "Scrobble remote plays",
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);

    expect(api).toHaveBeenCalledWith("/api/me/scrobble/preferences", "PUT", {
      remote_scrobbling_enabled: true,
    });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
});
