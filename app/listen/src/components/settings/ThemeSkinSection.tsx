import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Section } from "@/components/settings/SettingsPrimitives";
import { setMotionPreference } from "@/lib/motion-availability";
import { ThemeScope } from "@crate/ui/primitives/ThemeScope";
import {
  applyThemeSkin,
  MODE_REGISTRY,
  type ColorModePreference,
  type SkinId,
} from "@crate/ui/lib/theme-skin";
import {
  createDefaultAppearancePreferences,
  readAppearancePreferences,
  resolveAppearance,
  validateAppearanceContrast,
  writeAppearancePreferences,
  type AppearanceOverrides,
  type AppearancePreferencesV2,
} from "@crate/ui/lib/appearance-resolver";
import { SKIN_REGISTRY } from "@crate/ui/lib/theme-skin";

const MODE_OPTIONS = Object.values(MODE_REGISTRY).map((mode) => ({
  id: mode.id as ColorModePreference,
}));
const SKIN_OPTIONS = Object.values(SKIN_REGISTRY).map((skin) => ({
  id: skin.id as SkinId,
}));

const selectionButtonClass = (selected: boolean) =>
  `rounded-lg border px-3 py-3 text-left transition-colors focus-within:ring-2 focus-within:ring-focus-ring/50 ${
    selected
      ? "border-accent-action/50 bg-accent-action/15 text-accent-action"
      : "border-border-quiet/10 bg-text-primary/[0.03] text-text-primary/70 hover:bg-text-primary/[0.06]"
  }`;

function getStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readInitialPreferences(): AppearancePreferencesV2 {
  const storage = getStorage();
  return storage
    ? readAppearancePreferences(storage)
    : createDefaultAppearancePreferences();
}

function getEnvironment() {
  const prefersColorSchemeDark =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true;
  const prefersReducedMotion =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
  return { prefersColorSchemeDark, prefersReducedMotion };
}

export function ThemeSkinSection() {
  const { t } = useTranslation();
  const committedStore = useMemo(
    () => ({ value: readInitialPreferences() }),
    [],
  );
  const [draft, setDraft] = useState(readInitialPreferences);
  const [saveError, setSaveError] = useState(false);
  const preview = useMemo(
    () => resolveAppearance(draft, getEnvironment()),
    [draft],
  );

  const setOverride = <K extends keyof AppearanceOverrides>(
    key: K,
    value: AppearanceOverrides[K] | undefined,
  ) => {
    setDraft((current) => {
      const overrides = { ...current.overrides };
      if (value === undefined) delete overrides[key];
      else overrides[key] = value;
      return { ...current, overrides };
    });
  };

  const applyDraft = () => {
    const storage = getStorage();
    if (!storage) {
      setSaveError(true);
      return;
    }
    if (!validateAppearanceContrast(preview).valid) {
      setSaveError(true);
      return;
    }
    const result = writeAppearancePreferences(storage, draft);
    if (!result.v2Saved) {
      setSaveError(true);
      return;
    }
    const applied = applyThemeSkin(draft.mode, draft.preset, { storage });
    const next = { ...draft, mode: applied.mode, preset: applied.skin };
    committedStore.value = next;
    setMotionPreference(next.accessibility.motion);
    document.documentElement.dataset.crateMotion = next.accessibility.motion;
    setDraft(next);
    setSaveError(false);
  };

  const cancelDraft = () => {
    setDraft(committedStore.value);
    setSaveError(false);
  };

  const resetOverrides = () => {
    setDraft((current) => ({ ...current, overrides: {} }));
  };

  const renderOverride = <K extends keyof AppearanceOverrides>(
    key: K,
    labelKey: string,
    values: readonly string[],
  ) => (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-text-secondary">
      <span>{t(labelKey)}</span>
      <select
        aria-label={t(labelKey)}
        value={(draft.overrides[key] as string | undefined) ?? ""}
        onChange={(event) =>
          setOverride(
            key,
            event.target.value === ""
              ? undefined
              : (event.target.value as AppearanceOverrides[K]),
          )
        }
        className="min-h-9 rounded-md border border-border-quiet/20 bg-surface-control px-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-focus-ring/50"
      >
        <option value="">{t("settings.appearance.values.theme")}</option>
        {values.map((value) => (
          <option key={value} value={value}>
            {t(`settings.appearance.values.${value}`)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Section
      title={t("settings.appearance.title")}
      description={t("settings.appearance.description")}
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium text-text-secondary">
            {t("settings.appearance.modeLabel")}
          </p>
          <div
            className="grid gap-2 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t("settings.appearance.modeLabel")}
          >
            {MODE_OPTIONS.map((mode) => {
              const selected = draft.mode === mode.id;
              return (
                <label key={mode.id} className={selectionButtonClass(selected)}>
                  <input
                    type="radio"
                    name="crate-mode"
                    value={mode.id}
                    checked={selected}
                    onChange={() =>
                      setDraft((current) => ({ ...current, mode: mode.id }))
                    }
                    className="sr-only"
                  />
                  <span className="block text-sm font-semibold">
                    {t(`settings.appearance.modes.${mode.id}`)}
                  </span>
                </label>
              );
            })}
          </div>
          {draft.mode === "system" ? (
            <p className="mt-2 text-xs text-text-muted">
              {t("settings.appearance.systemPreference")}
            </p>
          ) : null}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-text-secondary">
            {t("settings.appearance.skinLabel")}
          </p>
          <div
            className="grid gap-2 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t("settings.appearance.skinLabel")}
          >
            {SKIN_OPTIONS.map((skin) => {
              const selected = draft.preset === skin.id;
              return (
                <label key={skin.id} className={selectionButtonClass(selected)}>
                  <input
                    type="radio"
                    name="crate-skin"
                    value={skin.id}
                    checked={selected}
                    onChange={() =>
                      setDraft((current) => ({ ...current, preset: skin.id }))
                    }
                    aria-describedby={`theme-skin-${skin.id}-description`}
                    className="sr-only"
                  />
                  <span className="block text-sm font-semibold">
                    {t(`settings.appearance.skinNames.${skin.id}`)}
                  </span>
                  <span
                    id={`theme-skin-${skin.id}-description`}
                    className="mt-1 block text-xs text-text-muted"
                  >
                    {t(`settings.appearance.skins.${skin.id}`)}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-text-secondary">
            {t("settings.appearance.overridesLabel")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {renderOverride("accent", "settings.appearance.accentLabel", [
              "cyan",
              "red",
              "violet",
            ])}
            {renderOverride(
              "surfaceTone",
              "settings.appearance.surfaceToneLabel",
              ["neutral", "warm", "tinted"],
            )}
            {renderOverride("material", "settings.appearance.materialLabel", [
              "solid",
              "glass",
            ])}
            {renderOverride("radius", "settings.appearance.radiusLabel", [
              "subtle",
              "rounded",
            ])}
            {renderOverride(
              "typography",
              "settings.appearance.typographyLabel",
              ["brand", "system"],
            )}
            {renderOverride("effects", "settings.appearance.effectsLabel", [
              "off",
              "subtle",
              "expressive",
            ])}
          </div>
        </div>

        <label className="flex max-w-sm flex-col gap-1 text-xs text-text-secondary">
          <span>{t("settings.appearance.motionLabel")}</span>
          <select
            aria-label={t("settings.appearance.motionLabel")}
            value={draft.accessibility.motion}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                accessibility: {
                  ...current.accessibility,
                  motion: event.target
                    .value as AppearancePreferencesV2["accessibility"]["motion"],
                },
              }))
            }
            className="min-h-9 rounded-md border border-border-quiet/20 bg-surface-control px-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-focus-ring/50"
          >
            <option value="system">
              {t("settings.appearance.values.system")}
            </option>
            <option value="reduced">
              {t("settings.appearance.values.reduced")}
            </option>
          </select>
        </label>

        <label className="flex max-w-sm flex-col gap-1 text-xs text-text-secondary">
          <span>{t("settings.appearance.densityLabel")}</span>
          <select
            aria-label={t("settings.appearance.densityLabel")}
            value={draft.presentation.density}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                presentation: {
                  ...current.presentation,
                  density: event.target
                    .value as AppearancePreferencesV2["presentation"]["density"],
                },
              }))
            }
            className="min-h-9 rounded-md border border-border-quiet/20 bg-surface-control px-2 text-xs text-text-primary outline-none focus:ring-2 focus:ring-focus-ring/50"
          >
            <option value="comfortable">
              {t("settings.appearance.values.comfortable")}
            </option>
            <option value="compact">
              {t("settings.appearance.values.compact")}
            </option>
          </select>
        </label>

        <ThemeScope
          appearance={preview}
          data-testid="appearance-preview"
          className="rounded-xl border border-border-quiet/20 bg-surface-container p-4"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent-action">
            {t("settings.appearance.previewLabel")}
          </p>
          <p className="mt-2 text-base font-semibold text-text-primary">
            {t("settings.appearance.previewTitle")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t("settings.appearance.previewDescription")}
          </p>
          <button
            type="button"
            className="mt-3 rounded-md bg-accent-action px-3 py-2 text-xs font-semibold text-accent-action-foreground shadow-action"
          >
            {t("player.play")}
          </button>
        </ThemeScope>

        {saveError ? (
          <p role="alert" className="text-sm text-state-danger">
            {t("settings.appearance.saveError")}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-border-quiet/20 px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface-control"
            onClick={resetOverrides}
          >
            {t("settings.appearance.actions.reset")}
          </button>
          <button
            type="button"
            className="rounded-md border border-border-quiet/20 px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface-control"
            onClick={cancelDraft}
          >
            {t("settings.appearance.actions.cancel")}
          </button>
          <button
            type="button"
            className="rounded-md bg-accent-action px-3 py-2 text-xs font-semibold text-accent-action-foreground shadow-action"
            onClick={applyDraft}
          >
            {t("settings.appearance.actions.apply")}
          </button>
        </div>
      </div>
    </Section>
  );
}
