import { Loader2 } from "@crate/ui/icons";

export function PullIndicator({
  distance,
  refreshing,
}: {
  distance: number;
  refreshing: boolean;
}) {
  if (distance <= 0 && !refreshing) return null;
  return (
    <div
      className="flex items-center justify-center overflow-hidden"
      style={{ height: refreshing ? 40 : distance }}
    >
      {refreshing ? (
        <Loader2 size={18} className="animate-spin text-accent-action" />
      ) : (
        <div
          className=" size-5 rounded-full border-2 border-accent-action/40 border-t-accent-action transition-transform"
          style={{
            transform: `rotate(${distance * 4}deg)`,
            opacity: Math.min(distance / 32, 1),
          }}
        />
      )}
    </div>
  );
}
