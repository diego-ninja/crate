import { Skeleton } from "@/components/ui/skeleton";

export function ArtistLoadingState() {
  return (
    <div className="-mx-8 -mt-8">
      <div className="h-[360px] bg-card animate-pulse" />
      <div className="px-8 pt-6">
        <div className="flex gap-2 mb-6">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-9 w-28" />)}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="bg-card border border-border rounded-lg p-3">
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
