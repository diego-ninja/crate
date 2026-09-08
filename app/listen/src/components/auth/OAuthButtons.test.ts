import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { OAuthButtons, openExternalOAuthUrl } from "./OAuthButtons";

const { apiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: apiMock,
  };
});

function defineWindowValue(key: string, value: unknown): void {
  Object.defineProperty(window, key, {
    value,
    configurable: true,
    writable: true,
  });
}

describe("openExternalOAuthUrl", () => {
  const originalOpen = window.open;

  afterEach(() => {
    defineWindowValue("open", originalOpen);
    Reflect.deleteProperty(window, "__TAURI__");
    vi.restoreAllMocks();
  });

  it("uses the Tauri opener global when present", async () => {
    const openUrl = vi
      .fn<(url: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    const windowOpen = vi.fn();
    defineWindowValue("__TAURI__", { opener: { openUrl } });
    defineWindowValue("open", windowOpen);

    await openExternalOAuthUrl("https://example.test/oauth");

    expect(openUrl).toHaveBeenCalledWith("https://example.test/oauth");
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("falls back to a browser popup when no Tauri opener is exposed", async () => {
    const windowOpen = vi.fn(() => ({ closed: false }));
    defineWindowValue("open", windowOpen);

    await openExternalOAuthUrl("https://example.test/oauth");

    expect(windowOpen).toHaveBeenCalledWith(
      "https://example.test/oauth",
      "_blank",
      "noopener,noreferrer",
    );
  });
});

describe("OAuthButtons", () => {
  afterEach(() => {
    apiMock.mockReset();
  });

  it("passes localized labels to the shared provider buttons", async () => {
    apiMock.mockResolvedValue({
      google: {
        enabled: true,
        configured: true,
        login_url: "https://example.test/oauth/google",
      },
      apple: {
        enabled: true,
        configured: false,
        login_url: null,
      },
    });

    render(
      createElement(I18nProvider, {
        initialLocale: "es",
        // The provider API requires children in its props type.
        // react-doctor-disable-next-line no-children-prop
        children: createElement(OAuthButtons),
      }),
    );

    expect(await screen.findByText("o")).toBeInTheDocument();
    expect(
      await screen.findByLabelText("Continuar con Google"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTitle("Inicio de sesión con Apple - próximamente"),
    ).toBeInTheDocument();
  });
});
