import { Link } from "react-router";
import { Disc3, Music4, PackagePlus } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { CrateImage } from "@/components/artwork/CrateImage";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { contributionSourceLabel } from "@/lib/contributions";
import { albumCoverApiUrl, albumPagePath } from "@/lib/library-routes";
import { formatTotalDuration } from "@/lib/utils";

import type { ProfileContribution, PublicProfile } from "./user-profile-model";

function ContributionCard({
  contribution,
}: {
  contribution: ProfileContribution;
}) {
  const { t } = useTranslation();
  const coverUrl =
    contribution.album_id && contribution.has_cover
      ? albumCoverApiUrl(
          {
            albumId: contribution.album_id,
            albumEntityUid: contribution.album_entity_uid,
            artistName: contribution.artist_name,
            albumName: contribution.album_name,
          },
          { size: 160 },
        )
      : null;
  const albumPath = contribution.album_id
    ? albumPagePath({
        albumId: contribution.album_id,
        albumEntityUid: contribution.album_entity_uid,
        albumSlug: contribution.album_slug,
        artistName: contribution.artist_name,
        albumName: contribution.album_name,
      })
    : null;
  const source =
    contributionSourceLabel(contribution.source) ||
    t("userProfile.contributions.source.library");
  const card = (
    <>
      {coverUrl ? (
        <CrateImage
          src={coverUrl}
          alt=""
          className=" size-14 rounded-xl object-cover"
        />
      ) : (
        <div className="user-profile-accent-panel user-profile-accent-icon flex size-14 items-center justify-center rounded-xl">
          <Disc3 size={20} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-text-primary">
          {contribution.album_name}
        </div>
        <div className="truncate text-xs text-text-muted">
          {contribution.artist_name}
        </div>
        <div className="user-profile-accent-label mt-1 text-xs font-bold uppercase tracking-[0.16em]">
          {t("userProfile.contributions.via", { source })}
        </div>
      </div>
    </>
  );

  if (!albumPath) {
    return (
      <div className="user-profile-item flex items-center gap-3 rounded-lg px-4 py-3">
        {card}
      </div>
    );
  }

  return (
    <Link
      to={albumPath}
      className="user-profile-item flex items-center gap-3 rounded-lg px-4 py-3"
    >
      {card}
    </Link>
  );
}

export function UserProfileLibrary({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  const contributions = data.contributions_preview || [];
  return (
    <section className="space-y-6">
      <div className="user-profile-card rounded-[12px] p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <PackagePlus size={16} className="user-profile-accent-icon" />
          <h2 className="text-lg font-semibold text-text-primary">
            {t("userProfile.contributions.title")}
          </h2>
        </div>
        <p className="mt-1 text-sm text-text-muted">
          {t("userProfile.contributions.subtitle")}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {contributions.length === 0 ? (
            <div className="user-profile-empty-state rounded-lg px-4 py-8 text-center text-sm text-text-muted sm:col-span-2">
              {t("userProfile.contributions.empty")}
            </div>
          ) : (
            contributions
              .slice(0, 6)
              .map((contribution) => (
                <ContributionCard
                  key={contribution.id}
                  contribution={contribution}
                />
              ))
          )}
        </div>
      </div>
      <UserProfilePlaylists data={data} />
    </section>
  );
}

function UserProfilePlaylists({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  return (
    <div className="user-profile-card rounded-[12px] p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Music4 size={16} className="user-profile-accent-icon" />
        <h2 className="text-lg font-semibold text-text-primary">
          {t("userProfile.playlists.title")}
        </h2>
      </div>
      <div className="mt-4 space-y-3">
        {data.public_playlists.length === 0 ? (
          <div className="user-profile-empty-state rounded-lg px-4 py-8 text-center text-sm text-text-muted">
            {t("userProfile.playlists.empty")}
          </div>
        ) : (
          data.public_playlists.map((playlist) => {
            const coverUrl = resolveMaybeApiAssetUrl(playlist.cover_data_url);
            return (
              <Link
                key={playlist.id}
                to={"/playlist/" + playlist.id}
                className="user-profile-item flex items-center gap-4 rounded-lg px-4 py-3"
              >
                {coverUrl ? (
                  <CrateImage
                    src={coverUrl}
                    alt={playlist.name}
                    className=" size-14 rounded-xl object-cover"
                  />
                ) : (
                  <div className="user-profile-placeholder flex size-14 items-center justify-center rounded-xl text-lg font-semibold">
                    {playlist.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text-primary">
                    {playlist.name}
                  </div>
                  <div className="mt-1 text-xs text-text-muted">
                    {t("common.trackCountLabel", {
                      count: playlist.track_count,
                    })}
                    {playlist.total_duration > 0
                      ? " · " + formatTotalDuration(playlist.total_duration)
                      : ""}
                    {playlist.is_collaborative
                      ? " · " + t("userProfile.playlists.collaborative")
                      : ""}
                  </div>
                  {playlist.description ? (
                    <div className="mt-1 truncate text-xs text-text-muted">
                      {playlist.description}
                    </div>
                  ) : null}
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
