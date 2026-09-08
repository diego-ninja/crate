import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ThemeSkinSection } from "@/components/settings/ThemeSkinSection";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

describe("ThemeSkinSection", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-crate-app");
    document.documentElement.removeAttribute("data-crate-mode");
    document.documentElement.removeAttribute("data-crate-mode-preference");
    document.documentElement.removeAttribute("data-crate-skin");
  });

  it("keeps appearance changes in a draft until Apply", async () => {
    const user = userEvent.setup();

    renderWithListenProviders(<ThemeSkinSection />, { locale: "en" });

    const defaultSkin = screen.getByRole("radio", { name: /Default/i });
    const crateRedSkin = screen.getByRole("radio", { name: /Crate Red/i });
    expect(defaultSkin).toBeChecked();
    expect(crateRedSkin).not.toBeChecked();

    await user.click(crateRedSkin);

    expect(crateRedSkin).toBeChecked();
    expect(document.documentElement.dataset.crateSkin).toBeUndefined();
    expect(localStorage.getItem("crate.listen.theme-skin")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Apply appearance/i }));

    expect(document.documentElement.dataset.crateSkin).toBe("crateRed");
    expect(localStorage.getItem("crate.listen.theme-skin")).toBe(
      JSON.stringify({ mode: "dark", skin: "crateRed" }),
    );
  });

  it("supports dark, light, and system color modes", async () => {
    const user = userEvent.setup();

    renderWithListenProviders(<ThemeSkinSection />, { locale: "en" });

    await user.click(screen.getByRole("radio", { name: /^Light$/i }));
    expect(document.documentElement.dataset.crateMode).toBeUndefined();

    await user.click(screen.getByRole("button", { name: /Apply appearance/i }));
    expect(document.documentElement.dataset.crateMode).toBe("light");
    expect(document.documentElement.dataset.crateModePreference).toBe("light");

    await user.click(screen.getByRole("radio", { name: /^System$/i }));
    expect(document.documentElement.dataset.crateModePreference).toBe("light");
    expect(screen.getByText(/system preference/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Apply appearance/i }));
    expect(localStorage.getItem("crate.listen.theme-skin")).toBe(
      JSON.stringify({ mode: "system", skin: "default" }),
    );
  });

  it("initializes from the persisted skin and migrates legacy values", () => {
    localStorage.setItem(
      "crate.listen.theme-skin",
      JSON.stringify({ theme: "dark", skin: "aurora" }),
    );

    renderWithListenProviders(<ThemeSkinSection />, { locale: "en" });

    expect(screen.getByRole("radio", { name: /Crate Red/i })).toBeChecked();
  });

  it("resets draft overrides without changing the committed skin", async () => {
    const user = userEvent.setup();

    renderWithListenProviders(<ThemeSkinSection />, { locale: "en" });
    const accentSelect = screen.getByLabelText("Accent", { exact: true });
    await user.selectOptions(accentSelect, "violet");
    expect(accentSelect).toHaveValue("violet");

    await user.click(
      screen.getByRole("button", { name: /Reset customization/i }),
    );
    expect(accentSelect).toHaveValue("");
    expect(document.documentElement.dataset.crateSkin).toBeUndefined();
  });

  it("persists the explicit reduced-motion preference on Apply", async () => {
    const user = userEvent.setup();

    renderWithListenProviders(<ThemeSkinSection />, { locale: "en" });
    const motionSelect = screen.getByLabelText("Motion", { exact: true });
    await user.selectOptions(motionSelect, "reduced");

    expect(
      JSON.parse(localStorage.getItem("crate.listen.appearance.v2") ?? "null"),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: /Apply appearance/i }));

    expect(
      JSON.parse(localStorage.getItem("crate.listen.appearance.v2")!),
    ).toEqual(
      expect.objectContaining({
        accessibility: { motion: "reduced" },
      }),
    );
  });
});
