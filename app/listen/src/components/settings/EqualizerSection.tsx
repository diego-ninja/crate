import { EqualizerPanel } from "@/components/player/EqualizerPanel";

/**
 * Settings page wrapper around the shared EqualizerPanel. Adds the
 * section chrome + helper text; the panel itself is the same component
 * used by the floating popover in the player.
 */
export function EqualizerSection() {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
      <EqualizerPanel variant="full" />
      <p className="mt-4 text-[11px] text-white/40">
        EQ runs as a post-processing chain on the audio output — no impact on gapless transitions or crossfade. Flat values mean no processing.
      </p>
    </section>
  );
}
