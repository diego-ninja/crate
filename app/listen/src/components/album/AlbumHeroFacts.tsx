import { Clock } from "@crate/ui/icons";

import { QualityBadge } from "@/components/player/bar/QualityBadge";
import { ReleaseCountdown } from "@/components/album/ReleaseCountdown";
import type { QualityBadge as QualityBadgeData } from "@/components/player/bar/player-bar-utils";
import type { AlbumData } from "@/pages/album-types";
import { formatTotalDuration } from "@/lib/utils";

export function AlbumHeroFacts({
  data,
  isPreRelease,
  year,
  genre,
  playerTrackCount,
  qualityBadges,
  t,
}: {
  data: AlbumData;
  isPreRelease: boolean;
  year?: string;
  genre?: string;
  playerTrackCount: number;
  qualityBadges: QualityBadgeData[];
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
        {year && <span>{year}</span>}
        {isPreRelease && data.release_date ? (
          <span>
            Releases{" "}
            {new Date(data.release_date + "T12:00:00").toLocaleDateString(
              "en-US",
              { month: "long", day: "numeric", year: "numeric" },
            )}
          </span>
        ) : null}
        {!data.genre_profile?.length && genre ? (
          <span className="hidden sm:inline">{genre}</span>
        ) : null}
        {data.track_count > 0 && (
          <span>
            {t("common.trackCountLabel", { count: data.track_count })}
          </span>
        )}
        {isPreRelease ? <span>{playerTrackCount} available now</span> : null}
        {data.total_length_sec > 0 && (
          <span className="flex items-center gap-1">
            <Clock size={11} />
            {formatTotalDuration(data.total_length_sec)}
          </span>
        )}
        {qualityBadges.map((badge) => (
          <QualityBadge key={badge.tier + "-" + badge.label} badge={badge} />
        ))}
      </div>
      {isPreRelease && data.release_date ? (
        <ReleaseCountdown releaseDate={data.release_date} />
      ) : null}
    </>
  );
}
