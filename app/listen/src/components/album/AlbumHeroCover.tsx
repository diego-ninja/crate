import { Disc } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import type { AlbumData } from "@/pages/album-types";

export function AlbumHeroCover({
  data,
  coverUrl,
  displayName,
}: {
  data: AlbumData;
  coverUrl: string;
  displayName: string;
}) {
  return (
    <div className="w-[200px] shrink-0 self-center sm:w-[240px] sm:self-auto lg:w-[280px]">
      <div
        data-testid="album-mobile-cover-spacer"
        aria-hidden="true"
        className="aspect-square sm:hidden"
      />
      <div
        data-testid="album-desktop-cover"
        className="hidden aspect-square overflow-hidden rounded-xl bg-text-primary/5 shadow-2xl ring-1 ring-text-primary/10 sm:block"
      >
        {data.has_cover || data.cover_url ? (
          <CrateImage
            src={coverUrl}
            alt={displayName}
            className=" size-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <Disc size={64} className="text-text-primary/10" />
          </div>
        )}
      </div>
    </div>
  );
}
