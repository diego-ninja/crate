import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ShareSheetHost } from "@/components/share/ShareSheet";
import { openShareSheet } from "@/lib/social-share";
import { openExternalUrl } from "@/lib/external-links";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/lib/capacitor-runtime", () => ({
  isNative: false,
}));

vi.mock("@/lib/external-links", () => ({
  openExternalUrl: vi.fn(),
}));

describe("ShareSheetHost", () => {
  it("opens Crate's share sheet instead of the native share dialog", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<ShareSheetHost />);

    act(() => {
      openShareSheet({
        kind: "album",
        title: "Jane Doe",
        subtitle: "Converge",
        url: "https://listen.example/share/album/1/jane-doe",
      });
    });

    expect(await screen.findByText("Share album")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Telegram")).toBeInTheDocument();
    expect(screen.queryByText("Instagram Story")).not.toBeInTheDocument();
    expect(screen.getByText("C").parentElement).toHaveClass(
      "shadow-share-preview",
    );
    expect(
      screen.getByText("WhatsApp").closest("button")?.querySelector("span"),
    ).toHaveClass("shadow-share-action-icon");

    await user.click(screen.getByText("Telegram"));
    expect(openExternalUrl).toHaveBeenCalledWith(
      expect.stringContaining("https://t.me/share/url"),
    );
  });

  it("localizes the share sheet chrome", async () => {
    renderWithListenProviders(<ShareSheetHost />, { locale: "es" });

    act(() => {
      openShareSheet({
        kind: "album",
        title: "Jane Doe",
        subtitle: "Converge",
        url: "https://listen.example/share/album/1/jane-doe",
      });
    });

    expect(await screen.findByText("Compartir álbum")).toBeInTheDocument();
    expect(
      screen.getByText("Enviar un enlace de Crate con vista previa"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Compartir en un chat o canal"),
    ).toBeInTheDocument();
    expect(screen.getByText("Copiar enlace")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cerrar menú de compartir" }),
    ).toBeInTheDocument();
  });
});
