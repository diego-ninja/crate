import "@crate/ui/tokens/index.css";
import "./harness.css";
import {
  applyAppearanceToRoot,
  inspectAppearancePreferences,
  resolveAppearance,
  writeAppearancePreferences,
} from "@crate/ui/lib/appearance-resolver";
import type {
  AppearancePreferencesV2,
  AppearanceResolution,
  ColorModePreference,
  Material,
  MotionPreference,
  PresetId,
} from "@crate/ui/lib/appearance-types";

const defaultPreferences: AppearancePreferencesV2 = {
  version: 2,
  mode: "dark",
  preset: "default",
  overrides: {},
  presentation: { density: "comfortable" },
  accessibility: { motion: "system" },
};

let activePreferences = readPreferences();
let draftPreferences = clonePreferences(activePreferences);
let primaryCleanup: (() => void) | undefined;
let secondaryCleanup: (() => void) | undefined;
let mediaCleanup: (() => void) | undefined;

function clonePreferences(
  value: AppearancePreferencesV2,
): AppearancePreferencesV2 {
  return JSON.parse(JSON.stringify(value)) as AppearancePreferencesV2;
}

function readPreferences(): AppearancePreferencesV2 {
  const result = inspectAppearancePreferences(window.localStorage);
  return result.status === "valid" ? result.preferences : defaultPreferences;
}

function environment() {
  return {
    prefersColorSchemeDark: window.matchMedia("(prefers-color-scheme: dark)")
      .matches,
    prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches,
  };
}

function resolve(preferences: AppearancePreferencesV2): AppearanceResolution {
  return resolveAppearance(preferences, environment());
}

function optionMarkup(options: string[], selected: string): string {
  return options
    .map(
      (option) =>
        `<option value="${option}"${
          option === selected ? " selected" : ""
        }>${option}</option>`,
    )
    .join("");
}

function render(): void {
  const root = document.querySelector<HTMLDivElement>("#app")!;
  root.innerHTML = `
    <section class="harness-shell" aria-label="Appearance contract harness">
      <header class="harness-header">
        <div>
          <p class="eyebrow">Crate appearance</p>
          <h1>Theme preview</h1>
          <p class="muted">Real token CSS and appearance resolver, isolated from production routes.</p>
        </div>
        <div class="status" aria-live="polite">
          <span data-testid="theme-mode"></span>
          <span data-testid="theme-skin"></span>
        </div>
      </header>
      <section class="controls" aria-label="Appearance controls">
        <label>Mode<select data-testid="mode-select">${optionMarkup(
          ["dark", "light", "system"],
          draftPreferences.mode,
        )}</select></label>
        <label>Preset<select data-testid="preset-select">${optionMarkup(
          ["default", "crateRed"],
          draftPreferences.preset,
        )}</select></label>
        <label>Material<select data-testid="material-select">${optionMarkup(
          ["glass", "solid"],
          draftPreferences.overrides.material ?? "glass",
        )}</select></label>
        <label>Motion<select data-testid="motion-select">${optionMarkup(
          ["system", "reduced"],
          draftPreferences.accessibility.motion,
        )}</select></label>
        <button type="button" data-testid="apply-button">Apply</button>
        <button type="button" data-testid="cancel-button">Cancel</button>
      </section>
      <div class="scopes">
        <section data-testid="preview-scope" class="scope scope-primary">
          <p class="scope-label">Primary scope</p>
          <article data-testid="appearance-card" class="appearance-card">
            <p class="eyebrow">Preview card</p>
            <h2>Listen to your library</h2>
            <p class="muted">Surface, text, accent and radius come from the active appearance.</p>
            <button type="button" class="accent-button">Play artist</button>
          </article>
          <div data-testid="portal-target" class="portal-target">
            <span data-testid="portal-content">Portal content remains in the primary scope.</span>
          </div>
        </section>
        <section data-testid="secondary-scope" class="scope scope-secondary">
          <p class="scope-label">Secondary scope</p>
          <article class="appearance-card">
            <p class="eyebrow">Unchanged scope</p>
            <h2>Default dark</h2>
          </article>
        </section>
      </div>
    </section>
  `;

  bindControls();
  applyScopes();
}

function setDraft<K extends keyof AppearancePreferencesV2>(
  key: K,
  value: AppearancePreferencesV2[K],
): void {
  draftPreferences = { ...draftPreferences, [key]: value };
}

function bindControls(): void {
  document.querySelector<HTMLSelectElement>(
    "[data-testid=mode-select]",
  )!.onchange = (event) => {
    setDraft(
      "mode",
      (event.target as HTMLSelectElement).value as ColorModePreference,
    );
  };
  document.querySelector<HTMLSelectElement>(
    "[data-testid=preset-select]",
  )!.onchange = (event) => {
    setDraft("preset", (event.target as HTMLSelectElement).value as PresetId);
  };
  document.querySelector<HTMLSelectElement>(
    "[data-testid=material-select]",
  )!.onchange = (event) => {
    const material = (event.target as HTMLSelectElement).value as Material;
    draftPreferences = {
      ...draftPreferences,
      overrides: { ...draftPreferences.overrides, material },
    };
  };
  document.querySelector<HTMLSelectElement>(
    "[data-testid=motion-select]",
  )!.onchange = (event) => {
    const motion = (event.target as HTMLSelectElement)
      .value as MotionPreference;
    draftPreferences = { ...draftPreferences, accessibility: { motion } };
  };
  document.querySelector<HTMLButtonElement>(
    "[data-testid=apply-button]",
  )!.onclick = () => {
    const result = writeAppearancePreferences(
      window.localStorage,
      draftPreferences,
    );
    if (result.v2Saved) {
      activePreferences = clonePreferences(draftPreferences);
      applyScopes();
    }
  };
  document.querySelector<HTMLButtonElement>(
    "[data-testid=cancel-button]",
  )!.onclick = () => {
    draftPreferences = clonePreferences(activePreferences);
    render();
  };
}

function applyScopes(): void {
  const primary = document.querySelector<HTMLElement>(
    "[data-testid=preview-scope]",
  )!;
  const secondary = document.querySelector<HTMLElement>(
    "[data-testid=secondary-scope]",
  )!;
  primaryCleanup?.();
  secondaryCleanup?.();
  const primaryAppearance = resolve(activePreferences);
  const secondaryAppearance = resolve(defaultPreferences);
  primaryCleanup = applyAppearanceToRoot(primary, primaryAppearance);
  secondaryCleanup = applyAppearanceToRoot(secondary, secondaryAppearance);

  document.documentElement.style.background = "var(--surface-canvas)";
  document.body.style.background = "var(--surface-canvas)";
  document.querySelector<HTMLElement>("[data-testid=theme-mode]")!.textContent =
    primaryAppearance.mode;
  document.querySelector<HTMLElement>("[data-testid=theme-skin]")!.textContent =
    primaryAppearance.preset;

  mediaCleanup?.();
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMediaChange = () => {
    if (activePreferences.mode === "system") applyScopes();
  };
  media.addEventListener("change", onMediaChange);
  mediaCleanup = () => media.removeEventListener("change", onMediaChange);
}

render();
