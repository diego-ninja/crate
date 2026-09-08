import { Loader2, Pause, Play } from "@crate/ui/icons";

interface SpinningDiscControlProps {
  disabled: boolean;
  isBuffering: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
}

export function SpinningDiscControl({
  disabled,
  isBuffering,
  isPlaying,
  onTogglePlay,
}: SpinningDiscControlProps) {
  return (
    <button
      type="button"
      onClick={onTogglePlay}
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      className="spinning-disc-control absolute left-1/2 top-1/2 z-10 flex size-[26%] min-h-[72px] min-w-[72px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full backdrop-blur-xl transition-transform duration-200 hover:scale-[1.03] active:scale-[0.97]"
      aria-label={isPlaying ? "Pause" : "Play"}
    >
      <span className="spinning-disc-control-ring absolute inset-[10%] rounded-full" />
      {isBuffering ? (
        <Loader2 size={22} className="animate-spin text-accent-action" />
      ) : isPlaying ? (
        <Pause size={22} className="text-text-primary" />
      ) : (
        <Play
          size={22}
          className="translate-x-[2px] fill-text-primary text-text-primary"
        />
      )}
    </button>
  );
}
