import { Loader2 } from "lucide-react";

export function PullIndicator({ distance, refreshing }: { distance: number; refreshing: boolean }) {
  if (distance <= 0 && !refreshing) return null;
  return (
    <div
      className="flex items-center justify-center overflow-hidden transition-[height] duration-200"
      style={{ height: refreshing ? 40 : distance }}
    >
      {refreshing ? (
        <Loader2 size={18} className="animate-spin text-primary" />
      ) : (
        <div
          className="h-5 w-5 rounded-full border-2 border-primary/40 border-t-primary transition-transform"
          style={{ transform: `rotate(${distance * 4}deg)`, opacity: Math.min(distance / 32, 1) }}
        />
      )}
    </div>
  );
}
