import { Calendar, Play } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { ArtistCard } from "@/components/cards/ArtistCard";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import {
  buildArtistPhotoUrl,
  type ArtistPlaylistAppearance,
} from "@/components/artist/artist-model";
import { artistPagePath } from "@/lib/library-routes";
import {
  groupByMonth,
  itemKey,
  UpcomingMonthGroup,
  type UpcomingItem,
} from "@/components/upcoming/UpcomingRows";

interface ArtistShowsSectionProps {
  shows: UpcomingItem[];
  expandedShowId: string | null;
  artistHotNow: boolean;
  onToggleExpand: (showId: string | null) => void;
  onPlayProbableSetlist: () => void;
}

export function ArtistShowsSection({
  shows,
  expandedShowId,
  artistHotNow,
  onToggleExpand,
  onPlayProbableSetlist,
}: ArtistShowsSectionProps) {
  const { t, i18n } = useTranslation();
  const nextAttendingShow = shows.find((item) => item.user_attending);
  if (!shows.length) return null;

  return (
    <section>
      <div className="mb-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-text-primary">
            {t("artist.sections.shows")}
          </h2>
          {artistHotNow ? (
            <div className="rounded-full border border-accent-action/20 bg-accent-action/10 px-3 py-1 text-xs uppercase tracking-[0.16em] text-accent-action">
              {t("artist.sections.heavyRotation")}
            </div>
          ) : null}
        </div>

        {nextAttendingShow ? (
          <div className="artist-show-prep-surface rounded-[12px] border border-accent-action/15 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-accent-action/20 bg-accent-action/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-accent-action">
                  <Calendar size={12} />
                  {t("artist.sections.showPrep")}
                </div>
                <h3 className="mt-3 text-xl font-bold text-text-primary">
                  {nextAttendingShow.title}
                </h3>
                <p className="mt-1 text-sm text-text-muted">
                  {nextAttendingShow.subtitle} ·{" "}
                  {new Date(
                    `${nextAttendingShow.date}T12:00:00`,
                  ).toLocaleDateString(i18n.language, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
                <p className="mt-3 text-sm leading-6 text-text-primary/70">
                  {nextAttendingShow.probable_setlist?.length
                    ? t("artist.sections.attendingWithSetlist")
                    : t("artist.sections.attendingWithoutSetlist")}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {nextAttendingShow.probable_setlist?.length ? (
                  <button
                    onClick={onPlayProbableSetlist}
                    className="inline-flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90"
                  >
                    <Play size={14} fill="currentColor" />
                    {t("artist.sections.playProbableSetlist")}
                  </button>
                ) : null}
                <button
                  onClick={() => onToggleExpand(itemKey(nextAttendingShow, 0))}
                  className="inline-flex items-center gap-2 rounded-lg border border-border-quiet px-4 py-2 text-sm text-text-primary/65 transition-colors hover:border-text-primary/20 hover:text-text-primary"
                >
                  {t("artist.sections.viewShowDetails")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        {groupByMonth(shows).map(([month, monthItems]) => (
          <UpcomingMonthGroup
            key={month}
            month={month}
            items={monthItems}
            expandedId={expandedShowId}
            onToggleExpand={onToggleExpand}
          />
        ))}
      </div>
    </section>
  );
}

interface RelatedArtistsSectionProps {
  artists: {
    name: string;
    match: number;
    id?: number;
    slug?: string;
    image_url?: string | null;
    url?: string | null;
    source?: string | null;
  }[];
}

export function RelatedArtistsSection({ artists }: RelatedArtistsSectionProps) {
  const { t } = useTranslation();
  if (!artists.length) return null;

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-text-primary">
        {t("artist.sections.relatedArtists")}
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {artists.slice(0, 15).map((artist) => {
          const inLibrary = artist.id != null;
          return (
            <ArtistCard
              key={artist.id ?? artist.name}
              name={artist.name}
              artistId={artist.id}
              artistSlug={artist.slug}
              photo={
                inLibrary
                  ? buildArtistPhotoUrl(artist.name, artist.id, artist.slug)
                  : artist.image_url || undefined
              }
              subtitle={
                artist.match
                  ? t("artist.sections.match", {
                      percent: Math.round(artist.match * 100),
                    })
                  : undefined
              }
              href={
                inLibrary
                  ? artistPagePath({
                      artistId: artist.id,
                      artistSlug: artist.slug,
                    })
                  : artist.url ||
                    `https://www.last.fm/music/${encodeURIComponent(
                      artist.name,
                    )}`
              }
              external={!inLibrary}
              imageTone={inLibrary ? "normal" : "muted"}
              large
              layout="grid"
            />
          );
        })}
      </div>
    </section>
  );
}

interface ArtistAppearsOnSectionProps {
  playlists: ArtistPlaylistAppearance[];
}

export function ArtistAppearsOnSection({
  playlists,
}: ArtistAppearsOnSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!playlists.length) return null;

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-text-primary">
        {t("artist.sections.appearsOn")}
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {playlists.slice(0, 8).map((playlist) => {
          const artistTrackCount = playlist.artist_track_count ?? 0;
          return (
            <PlaylistCard
              key={playlist.id}
              playlistId={playlist.id}
              name={playlist.name}
              isSmart={!!playlist.is_smart}
              description={playlist.description ?? undefined}
              tracks={playlist.artwork_tracks}
              coverDataUrl={playlist.cover_data_url}
              meta={
                artistTrackCount > 0
                  ? t("artist.sections.tracksHere", {
                      count: artistTrackCount,
                    })
                  : t("common.trackCountLabel", {
                      count: playlist.track_count ?? 0,
                    })
              }
              systemPlaylist
              crateManaged={playlist.scope === "system"}
              layout="grid"
              onClick={() => navigate(`/curation/playlist/${playlist.id}`)}
            />
          );
        })}
      </div>
    </section>
  );
}
