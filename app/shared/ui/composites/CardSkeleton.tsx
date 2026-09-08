import { Skeleton } from "@crate/ui/shadcn/skeleton";

export function CardSkeleton() {
  return (
    <div className="bg-surface-container border border-border-subtle rounded-md p-6">
      <Skeleton className="h-8 w-20 mb-2" />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}
