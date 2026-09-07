import { useTranslation } from "react-i18next";
import { Music4 } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import type { Track } from "@/contexts/player-types";

export function InfoTabHeroArtwork({
  currentTrack,
  albumName,
}: {
  currentTrack: Track;
  albumName: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="info-tab-artwork relative size-24 shrink-0 overflow-hidden rounded-xl sm:size-28">
      {currentTrack.albumCover ? (
        <CrateImage
          src={currentTrack.albumCover}
          alt={t("player.info.albumCoverAlt", {
            name: albumName || currentTrack.title,
          })}
          width={112}
          height={112}
          loading="lazy"
          className=" size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-text-muted">
          <Music4 size={28} />
        </div>
      )}
    </div>
  );
}
