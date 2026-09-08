import { Skeleton } from "@crate/ui/shadcn/skeleton";

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

function skeletonKeys(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}-skeleton-${index}`,
  );
}

export function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="flex gap-4 p-3 border-b border-border bg-card">
        {skeletonKeys("table-header", columns).map((key) => (
          <Skeleton key={key} className="h-4 flex-1" />
        ))}
      </div>
      {skeletonKeys("table-row", rows).map((rowKey) => (
        <div
          key={rowKey}
          className="flex gap-4 p-3 border-b border-border last:border-b-0"
        >
          {skeletonKeys(`${rowKey}-column`, columns).map((columnKey) => (
            <Skeleton key={columnKey} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
