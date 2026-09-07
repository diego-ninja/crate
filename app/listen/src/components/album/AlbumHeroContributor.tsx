import { User } from "@crate/ui/icons";

import {
  GenrePillRow,
  type GenreProfileItem,
} from "@crate/ui/domain/genres/GenrePill";
import { CrateImage } from "@/components/artwork/CrateImage";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import type { AlbumContributor, AlbumData } from "@/pages/album-types";

export function AlbumHeroContributor({
  data,
  visibleContributor,
  primaryContributorName,
  primaryContributorPath,
  primaryContributorSource,
  onGenreSelect,
}: {
  data: AlbumData;
  visibleContributor: AlbumContributor | null;
  primaryContributorName: string | null;
  primaryContributorPath: string | null;
  primaryContributorSource: string | null;
  onGenreSelect: (item: GenreProfileItem) => void;
}) {
  return (
    <>
      {visibleContributor ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
          <span className="inline-flex size-6 items-center justify-center overflow-hidden rounded-full bg-text-primary/8 ring-1 ring-text-primary/10">
            {visibleContributor.user_avatar ? (
              <CrateImage
                src={visibleContributor.user_avatar}
                alt=""
                className=" size-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <User size={13} />
            )}
          </span>
          <span>
            Added to Crate by{" "}
            {primaryContributorPath ? (
              <UserProfileLink
                username={visibleContributor.user_username}
                to={primaryContributorPath}
                className="font-medium text-text-primary/85 transition-colors hover:text-accent-action"
              >
                {primaryContributorName}
              </UserProfileLink>
            ) : (
              <span className="font-medium text-text-primary/85">
                {primaryContributorName}
              </span>
            )}
            {primaryContributorSource ? (
              <span className="text-text-muted/70">
                {" "}
                via {primaryContributorSource}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      {data.genre_profile && data.genre_profile.length > 0 ? (
        <GenrePillRow
          items={data.genre_profile}
          max={6}
          className="mt-3 hidden sm:flex"
          onSelect={onGenreSelect}
        />
      ) : null}
    </>
  );
}
