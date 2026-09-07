import { useTranslation } from "react-i18next";

import { RadioSeedPanel } from "./RadioSeedPanel";
import { RadioSessionStatus } from "./RadioSessionStatus";
import { RadioStationRail } from "./RadioStationRail";
import { RadioHero } from "./RadioHero";
import { useRadioController } from "./use-radio-controller";

export function RadioPage() {
  const { t } = useTranslation();
  const radio = useRadioController();

  return (
    <div className="radio-page animate-page-in space-y-7 px-4  sm:p-6">
      <RadioHero
        starting={radio.starting}
        discoveryAvailable={radio.discoveryAvailable}
        onStartDiscovery={radio.startDiscovery}
      />

      <RadioSessionStatus
        activeSession={radio.activeSession}
        activeMode={radio.activeMode}
        seedLabel={radio.seedLabel}
      />

      <RadioStationRail
        title={t("radio.artistStations.title")}
        subtitle={t("radio.artistStations.subtitle")}
        stations={radio.artistStations}
        loading={radio.stationsLoading}
        disabled={radio.starting}
        onStart={radio.startStation}
      />

      <RadioStationRail
        title={t("radio.genreStations.title")}
        subtitle={t("radio.genreStations.subtitle")}
        stations={radio.genreStations}
        loading={radio.stationsLoading}
        disabled={radio.starting}
        onStart={radio.startStation}
      />

      {radio.stationsError ? (
        <div className="radio-error rounded-xl px-4 py-3 text-sm">
          {t("radio.errors.stations")}
        </div>
      ) : null}

      <RadioSeedPanel
        query={radio.query}
        searching={radio.searching}
        results={radio.results}
        starting={radio.starting}
        onQueryChange={radio.onQueryChange}
        onStartSeeded={radio.startSeeded}
      />
    </div>
  );
}
