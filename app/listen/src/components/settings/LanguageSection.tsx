import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Globe } from "@crate/ui/icons";

import { Section } from "@/components/settings/SettingsPrimitives";
import {
  clearLocalListenLocalePreference,
  getLocalListenLocalePreference,
  setLocalListenLocalePreference,
} from "@/i18n/language-preference";
import { detectPreferredLocale } from "@/i18n/language-detector";
import {
  LISTEN_SUPPORTED_LOCALES,
  type ListenLocale,
  toSupportedListenLocale,
} from "@/i18n/locales";

type LanguageSelection = "auto" | ListenLocale;

const LANGUAGE_OPTIONS: { value: ListenLocale; labelKey: string }[] =
  LISTEN_SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    labelKey: `settings.language.options.${locale}`,
  }));

function getAutomaticListenLocale(): ListenLocale {
  return detectPreferredLocale({
    browserLanguages:
      typeof navigator === "undefined" ? [] : navigator.languages,
  });
}

export function LanguageSection({
  i18n,
}: {
  i18n: ReturnType<typeof useTranslation>["i18n"];
}) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<LanguageSelection>(
    () => getLocalListenLocalePreference() ?? "auto",
  );
  const activeLocale =
    selection === "auto"
      ? toSupportedListenLocale(i18n.resolvedLanguage) ??
        getAutomaticListenLocale()
      : selection;

  const changeLanguage = (nextSelection: LanguageSelection) => {
    setSelection(nextSelection);
    const nextLocale =
      nextSelection === "auto" ? getAutomaticListenLocale() : nextSelection;

    if (nextSelection === "auto") {
      clearLocalListenLocalePreference();
    } else {
      setLocalListenLocalePreference(nextSelection);
    }

    void i18n.changeLanguage(nextLocale);
  };

  return (
    <Section
      title={t("settings.language.title")}
      description={t("settings.language.description")}
    >
      <div
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
        role="radiogroup"
        aria-label={t("settings.language.title")}
      >
        <button
          type="button"
          role="radio"
          aria-checked={selection === "auto"}
          onClick={() => changeLanguage("auto")}
          className={`rounded-lg border p-3 text-left transition-colors ${
            selection === "auto"
              ? "border-accent-action/50 bg-accent-action/15 text-accent-action"
              : "border-border-quiet/10 bg-text-primary/[0.03] text-text-primary/70 hover:bg-text-primary/[0.06]"
          }`}
        >
          <span className="block text-sm font-semibold">
            {t("settings.language.auto")}
          </span>
          <span className="mt-1 block text-xs text-text-muted">
            {t("settings.language.autoDescription")}
          </span>
        </button>

        {LANGUAGE_OPTIONS.map((option) => {
          const selected = selection === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => changeLanguage(option.value)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                selected
                  ? "border-accent-action/50 bg-accent-action/15 text-accent-action"
                  : "border-border-quiet/10 bg-text-primary/[0.03] text-text-primary/70 hover:bg-text-primary/[0.06]"
              }`}
            >
              <span className="block text-sm font-semibold">
                {t(option.labelKey)}
              </span>
              <span className="mt-1 block text-xs uppercase tracking-[0.18em] text-text-muted">
                {option.value}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-border-quiet/10 bg-text-primary/[0.03] px-4 py-3 text-sm text-text-muted">
        <Globe size={16} className="mt-0.5 text-accent-action/80" />
        <span>
          {t("settings.language.current", {
            language: t(`settings.language.options.${activeLocale}`),
          })}
        </span>
      </div>
    </Section>
  );
}
