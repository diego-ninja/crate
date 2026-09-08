import { Skeleton } from "@crate/ui/shadcn/skeleton";

const ACTION_SKELETON_KEYS = Array.from(
  { length: 6 },
  (_, index) => `artist-action-skeleton-${index}`,
);
const ALBUM_SKELETON_KEYS = Array.from(
  { length: 8 },
  (_, index) => `artist-album-skeleton-${index}`,
);

export function ArtistLoadingState() {
  return (
    <div className="-mx-8 -mt-8">
      <div className="h-[360px] bg-card animate-pulse" />
      <div className="px-8 pt-6">
        <div className="flex gap-2 mb-6">
          {ACTION_SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className="h-9 w-28" />
          ))}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          {ALBUM_SKELETON_KEYS.map((key) => (
            <div
              key={key}
              className="bg-card border border-border rounded-md p-3"
            >
              <Skeleton className="w-full aspect-square rounded-md mb-2" />
              <Skeleton className="h-4 w-3/4 mb-1" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
