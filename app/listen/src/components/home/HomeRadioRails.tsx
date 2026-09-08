import { useTranslation } from "react-i18next";
import { Radio } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import {
  SectionHeader,
  SectionRail,
  useSectionRail,
} from "@/components/home/HomeSections";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";
import { cn } from "@/lib/utils";

import type { HomeRadioStation, HomeSectionId } from "./home-model";

function radioArtwork(station: HomeRadioStation): string | null {
  if (station.type === "album") {
    return (
      albumCoverApiUrl(
        {
          albumId: station.album_id,
          globalAlbumUid: station.global_album_uid,
          albumEntityUid: station.album_entity_uid,
          artistEntityUid: station.artist_entity_uid,
          albumSlug: station.album_slug,
          artistName: station.artist_name,
          albumName: station.album_name,
        },
        { size: 256 },
      ) || null
    );
  }
  return (
    artistPhotoApiUrl(
      {
        artistId: station.artist_id,
        globalArtistUid: station.global_artist_uid,
        artistEntityUid: station.artist_entity_uid,
        artistSlug: station.artist_slug,
        artistName: station.artist_name,
      },
      { size: 256 },
    ) || null
  );
}

function radioSeedTypeLabel(
  station: HomeRadioStation,
  labels: {
    track: string;
    album: string;
    genre: string;
    artist: string;
  },
): string {
  const seedType = station.seed_type ?? station.type;
  if (seedType === "track") return labels.track;
  if (seedType === "album") return labels.album;
  if (seedType === "genre") return labels.genre;
  return labels.artist;
}

function radioSeedLabel(station: HomeRadioStation): string {
  return (
    station.seed_label ||
    station.track_title ||
    station.album_name ||
    station.artist_name ||
    station.genre_name ||
    station.title.replace(/\s+Radio$/i, "")
  );
}

function radioSeedSubtitle(station: HomeRadioStation): string | null {
  return (
    station.seed_subtitle ||
    (station.type === "album" ? station.artist_name : null) ||
    (station.type === "track" ? station.artist_name : null) ||
    null
  );
}

export function RadioStationCard({
  station,
  onPlay,
  layout = "rail",
}: {
  station: HomeRadioStation;
  onPlay: () => void;
  layout?: "rail" | "grid";
}) {
  const { t } = useTranslation();
  const artworkUrl = radioArtwork(station);
  const seedTypeLabel = radioSeedTypeLabel(station, {
    track: t("home.radio.track"),
    album: t("home.radio.album"),
    genre: t("home.radio.genre"),
    artist: t("home.radio.artist"),
  });
  const seedLabel = radioSeedLabel(station);
  const seedSubtitle = radioSeedSubtitle(station);

  return (
    <button
      onClick={onPlay}
      className={cn(
        "home-radio-card group relative overflow-hidden rounded-[12px] text-left",
        layout === "grid" ? "w-full min-w-0" : "w-full min-w-0 snap-start",
      )}
    >
      {artworkUrl ? (
        <CrateImage
          src={artworkUrl}
          alt=""
          className="aspect-square size-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.04]"
        />
      ) : (
        <div className="aspect-square" />
      )}
      <div className="home-radio-overlay absolute inset-0" />
      <div className="home-radio-badge absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-[0.16em] backdrop-blur-md">
        <Radio size={12} className="inline-block" /> {seedTypeLabel}
      </div>
      <div className="absolute inset-x-0 bottom-0 p-4">
        <div className="home-radio-title truncate text-sm font-semibold">
          {seedLabel}
        </div>
        {seedSubtitle ? (
          <div className="home-radio-subtitle mt-1 line-clamp-2 text-xs leading-5">
            {seedSubtitle}
          </div>
        ) : null}
      </div>
    </button>
  );
}

export function RadioStationsSection({
  stations,
  onPlayStation,
  onViewAll,
}: {
  stations: HomeRadioStation[];
  onPlayStation: (station: HomeRadioStation) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const rail = useSectionRail(stations.length);
  if (!stations.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.radioStations.title")}
        subtitle={t("home.sections.radioStations.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("radio-stations")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} fit="square-card">
        {stations.map((station) => (
          <RadioStationCard
            key={`${station.type}-${
              station.seed_value ??
              station.global_artist_uid ??
              station.global_album_uid ??
              station.artist_id ??
              station.album_id ??
              station.title
            }`}
            station={station}
            onPlay={() => onPlayStation(station)}
          />
        ))}
      </SectionRail>
    </section>
  );
}
