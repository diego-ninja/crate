import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useTranslation } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n/I18nProvider";
import { stripTranslationMarker } from "@/i18n/translation-mode/markers";
import { TranslationOverlay } from "@/i18n/translation-mode/TranslationOverlay";

function Probe() {
  const { t } = useTranslation();
  return <button type="button">{t("player.play")}</button>;
}

function renderOverlay() {
  render(
    <I18nProvider initialLocale="es">
      <Probe />
      <TranslationOverlay />
    </I18nProvider>,
  );
}

function findPlayButton() {
  return screen.findByRole("button", {
    name: (name) => stripTranslationMarker(name) === "Reproducir",
  });
}

describe("TranslationOverlay", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
    Object.defineProperty(navigator, "languages", {
      value: ["en-US"],
      configurable: true,
    });
  });

  it("is absent when translation mode is disabled", async () => {
    vi.stubEnv("VITE_TRANSLATION_MODE", "0");
    renderOverlay();

    fireEvent.keyDown(window, { key: "t", ctrlKey: true, altKey: true });
    expect(await findPlayButton()).toBeInTheDocument();
    expect(screen.queryByText("Translation Mode")).not.toBeInTheDocument();
  });

  it("shows the hovered key after translation mode is toggled", async () => {
    const user = userEvent.setup();
    vi.stubEnv("VITE_TRANSLATION_MODE", "1");
    renderOverlay();

    fireEvent.keyDown(window, { key: "t", ctrlKey: true, altKey: true });
    await user.hover(await findPlayButton());

    expect(await screen.findByText("Translation Mode")).toBeInTheDocument();
    expect(screen.getAllByText("player.play").length).toBeGreaterThan(0);
    expect(screen.getByText("Translation Mode").parentElement).toHaveClass(
      "shadow-translation-marker",
    );
  });

  it("uses the muted semantic shadow before a marker is hovered", async () => {
    vi.stubEnv("VITE_TRANSLATION_MODE", "1");
    renderOverlay();

    fireEvent.keyDown(window, { key: "t", ctrlKey: true, altKey: true });

    expect(screen.getByText("Translation Mode")).toHaveClass(
      "shadow-translation-marker-muted",
    );
  });

  it("opens an editor and saves changes to the dev catalog endpoint", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (
        String(input) === "/__crate_i18n/catalogs/es" &&
        init?.method === "PATCH"
      ) {
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("VITE_TRANSLATION_MODE", "1");
    renderOverlay();

    fireEvent.keyDown(window, { key: "t", ctrlKey: true, altKey: true });
    await user.click(await findPlayButton());

    expect(await screen.findByRole("dialog")).toHaveAccessibleName(
      "Edit translation",
    );
    expect(screen.getByRole("dialog")).toHaveClass("shadow-translation-editor");
    expect(screen.getAllByText("player.play").length).toBeGreaterThan(0);
    expect(screen.getByText("Play")).toBeInTheDocument();
    expect(screen.getByText("Not checked locally")).toBeInTheDocument();

    const valueInput = screen.getByLabelText("Current value");
    await user.clear(valueInput);
    await user.type(valueInput, "Dale");
    const saveButton = screen.getByRole("button", {
      name: "Save translation",
    });
    expect(saveButton).toHaveClass("rounded-lg");
    await user.click(saveButton);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/__crate_i18n/catalogs/es",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    const patchCall = fetchSpy.mock.calls.find(
      ([url, init]) =>
        String(url) === "/__crate_i18n/catalogs/es" && init?.method === "PATCH",
    );
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      key: "player.play",
      value: "Dale",
      markReviewed: true,
    });
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("button")
          .some(
            (button) =>
              stripTranslationMarker(button.textContent ?? "") === "Dale",
          ),
      ).toBe(true);
    });
  });
});
