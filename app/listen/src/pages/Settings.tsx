import { useTranslation } from "react-i18next";

import { AccountSection } from "@/components/settings/AccountSection";
import { BandcampSection } from "@/components/settings/BandcampSection";
import { LanguageSection } from "@/components/settings/LanguageSection";
import { LinksSection } from "@/components/settings/LinksSection";
import { OfflineSection } from "@/components/settings/OfflineSection";
import { PlaybackSection } from "@/components/settings/PlaybackSection";
import { ScrobbleSection } from "@/components/settings/ScrobbleSection";
import { ShowsLocationSection } from "@/components/settings/ShowsLocationSection";
import { SleepTimerSection } from "@/components/settings/SleepTimerSection";
import { ServersSection } from "@/components/settings/ServersSection";
import { ThemeSkinSection } from "@/components/settings/ThemeSkinSection";

export function Settings() {
  const { t, i18n } = useTranslation();

  return (
    <div className="space-y-8">
      <div className="settings-header">
        <h1 className="text-3xl font-bold text-text-primary">
          {t("settings.title")}
        </h1>
        <p className="mt-1 text-sm text-text-muted">{t("settings.subtitle")}</p>
      </div>

      <ThemeSkinSection />
      <LanguageSection i18n={i18n} />
      <PlaybackSection />
      <OfflineSection />
      <ServersSection />
      <ShowsLocationSection />
      <SleepTimerSection />
      <AccountSection />
      <ScrobbleSection />
      <BandcampSection />
      <LinksSection />
    </div>
  );
}
