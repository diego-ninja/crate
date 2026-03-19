import { Skeleton } from "@/components/ui/skeleton";

interface GridSkeletonProps {
  count?: number;
  columns?: string;
}

export function GridSkeleton({
  count = 12,
  columns = "grid-cols-[repeat(auto-fill,minmax(200px,1fr))]",
}: GridSkeletonProps) {
  return (
    <div className={`grid ${columns} gap-4`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-card border border-border rounded-lg p-3">
          <Skeleton className="w-full aspect-square rounded-md mb-2" />
          <Skeleton className="h-4 w-3/4 mb-1" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
