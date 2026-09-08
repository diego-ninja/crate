import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";

import { CrateImage } from "@/components/artwork/CrateImage";
import type { AlbumData } from "@/pages/album-types";

export function AlbumHeroDetails({
  data,
  artistPhotoUrl,
  displayName,
  isPreRelease,
  canPersistAlbum,
  offlineState,
  onArtistNavigate,
}: {
  data: AlbumData;
  artistPhotoUrl: string;
  displayName: string;
  isPreRelease: boolean;
  canPersistAlbum: boolean;
  offlineState: Parameters<typeof OfflineBadge>[0]["state"];
  onArtistNavigate: () => void;
}) {
  return (
    <>
      <div className="mb-1.5 flex flex-col items-start gap-2">
        {isPreRelease ? (
          <span className="rounded-full border border-accent-action/20 bg-accent-action/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-accent-action">
            Pre-release
          </span>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="max-w-4xl text-2xl font-bold text-text-primary sm:text-4xl">
            {displayName}
          </h1>
          {canPersistAlbum ? <OfflineBadge state={offlineState} /> : null}
        </div>
      </div>
      <button
        className="mb-3 inline-flex items-center gap-2 self-start text-sm text-text-muted transition-colors hover:text-accent-action"
        onClick={onArtistNavigate}
      >
        <span className=" size-6 shrink-0 overflow-hidden rounded-full bg-text-primary/5">
          <CrateImage
            src={artistPhotoUrl}
            alt={data.artist}
            className=" size-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </span>
        {data.artist}
      </button>
    </>
  );
}
