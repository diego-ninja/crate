import { Skeleton } from "@crate-ui/shadcn/skeleton";

export function CardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-md p-6">
      <Skeleton className="h-8 w-20 mb-2" />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}
