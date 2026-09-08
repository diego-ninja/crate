import { useTranslation } from "react-i18next";
import { Play } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import {
  SectionHeader,
  SectionLoading,
  SectionRail,
} from "@/components/home/HomeSections";

import {
  stationArtwork,
  stationLabel,
  stationTypeLabelKey,
  type PersonalizedRadioStation,
} from "./radio-model";

function RadioStationCard({
  station,
  disabled,
  onStart,
}: {
  station: PersonalizedRadioStation;
  disabled: boolean;
  onStart: (station: PersonalizedRadioStation) => void;
}) {
  const { t } = useTranslation();
  const label = stationLabel(station);
  const imageUrl = stationArtwork(station);
  const plays = station.play_count || 0;
  const typeLabel = t(stationTypeLabelKey(station));

  return (
    <button
      type="button"
      aria-label={t("radio.station.startAria", { label, type: typeLabel })}
      disabled={disabled}
      onClick={() => onStart(station)}
      className="radio-station-card group relative aspect-square snap-start overflow-hidden rounded-xl text-left transition duration-300"
    >
      {imageUrl ? (
        <CrateImage
          src={imageUrl}
          alt=""
          className="absolute inset-0 size-full object-cover opacity-85 transition duration-500 group-hover:scale-[1.04] group-hover:opacity-100"
          loading="lazy"
        />
      ) : (
        <div
          className="radio-station-placeholder absolute inset-0"
          data-station-type={station.type}
        />
      )}
      <div className="radio-station-overlay absolute inset-0" />
      <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
        <span className="radio-station-type rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] backdrop-blur-md">
          {typeLabel}
        </span>
        <span className="radio-station-play flex size-8 items-center justify-center rounded-full opacity-0 transition duration-300 group-focus-within:opacity-100 group-hover:opacity-100">
          <Play size={14} className="translate-x-px" />
        </span>
      </div>
      <div className="absolute inset-x-3 bottom-3">
        <div className="radio-station-label line-clamp-2 text-base font-semibold leading-tight">
          {label}
        </div>
        {plays > 0 ? (
          <div className="radio-station-count mt-1 text-xs">
            {t("common.playCount", { count: plays })}
          </div>
        ) : null}
      </div>
    </button>
  );
}

export function RadioStationRail({
  title,
  subtitle,
  stations,
  loading,
  disabled,
  onStart,
}: {
  title: string;
  subtitle: string;
  stations: PersonalizedRadioStation[];
  loading: boolean;
  disabled: boolean;
  onStart: (station: PersonalizedRadioStation) => void;
}) {
  if (loading) {
    return (
      <section className="space-y-4">
        <SectionHeader title={title} subtitle={subtitle} />
        <SectionLoading />
      </section>
    );
  }

  if (!stations.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader title={title} subtitle={subtitle} />
      <SectionRail fit="square-card">
        {stations.map((station) => (
          <RadioStationCard
            key={`${station.seed_type}-${station.seed_value}`}
            station={station}
            disabled={disabled}
            onStart={onStart}
          />
        ))}
      </SectionRail>
    </section>
  );
}
