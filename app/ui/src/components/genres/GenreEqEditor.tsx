import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Save, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

// 10-band contract — mirrors app/listen/src/lib/equalizer.ts. Kept as a
// local copy here (admin and listen are separate bundles); if the band
// list ever grows this must be bumped in both places.
const EQ_BANDS = [
  { freq: 32, label: "32" },
  { freq: 64, label: "64" },
  { freq: 125, label: "125" },
  { freq: 250, label: "250" },
  { freq: 500, label: "500" },
  { freq: 1000, label: "1K" },
  { freq: 2000, label: "2K" },
  { freq: 4000, label: "4K" },
  { freq: 8000, label: "8K" },
  { freq: 16000, label: "16K" },
] as const;

const EQ_GAIN_MIN = -12;
const EQ_GAIN_MAX = 12;
const FLAT_GAINS: number[] = new Array(EQ_BANDS.length).fill(0);

interface ResolvedPreset {
  gains: number[];
  source: "direct" | "inherited";
  slug: string;
  name: string;
}

interface Props {
  /** Canonical taxonomy slug. The editor only mounts when mapped. */
  canonicalSlug: string;
  canonicalName: string;
  /** Current eq_gains on the taxonomy node. null = inherits from parent. */
  initialGains: number[] | null;
  /** Resolved preset (direct or inherited from an ancestor). */
  initialResolved: ResolvedPreset | null;
  /** Called on successful save / clear so the parent can refetch. */
  onSaved?: () => void;
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > 0.001) return false;
  }
  return true;
}

/**
 * Admin editor for the per-genre EQ preset.
 *
 * The state machine is small but worth spelling out:
 *
 *   DB state         | UI shows                  | Save payload
 *   -----------------+---------------------------+---------------
 *   own gains        | sliders = own             | { gains }
 *   null + ancestor  | sliders = resolved (ro+)  | { gains }
 *   null + no parent | sliders = flat            | { gains }
 *
 * The "+" means the sliders are still editable — dragging any of them
 * makes the node own its preset (clicking Save persists it). The
 * "Clear" button posts `gains: null` to drop back to inheritance.
 */
export function GenreEqEditor({
  canonicalSlug,
  canonicalName,
  initialGains,
  initialResolved,
  onSaved,
}: Props) {
  // Seed the sliders: own gains → resolved → flat. Resolved covers the
  // "inherits from ancestor" case so the user sees what's playing even
  // when eq_gains is null.
  const seeded = useMemo<number[]>(() => {
    if (initialGains && initialGains.length === EQ_BANDS.length) return [...initialGains];
    if (initialResolved?.gains.length === EQ_BANDS.length) return [...initialResolved.gains];
    return [...FLAT_GAINS];
  }, [initialGains, initialResolved]);

  const [gains, setGains] = useState<number[]>(seeded);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Reset local state when the parent props change (e.g. after refetch
  // triggers a new initialGains / initialResolved).
  useEffect(() => { setGains(seeded); }, [seeded]);

  const dirty = !arraysEqual(gains, seeded);
  const hasOwnPreset = initialGains !== null;
  const inherited = !hasOwnPreset && initialResolved?.source === "inherited";
  const range = EQ_GAIN_MAX - EQ_GAIN_MIN;

  const updateBand = (index: number, dB: number) => {
    setGains((prev) => {
      const next = [...prev];
      next[index] = dB;
      return next;
    });
  };

  const save = async () => {
    if (saving || clearing) return;
    setSaving(true);
    try {
      await api(`/api/genres/${canonicalSlug}/eq-preset`, "PATCH", { gains });
      toast.success(`Saved EQ preset for ${canonicalName}`);
      onSaved?.();
    } catch {
      toast.error("Failed to save preset");
    } finally {
      setSaving(false);
    }
  };

  const clearPreset = async () => {
    if (saving || clearing) return;
    setClearing(true);
    try {
      await api(`/api/genres/${canonicalSlug}/eq-preset`, "PATCH", { gains: null });
      toast.success(`Cleared preset for ${canonicalName} — will inherit from parent`);
      onSaved?.();
    } catch {
      toast.error("Failed to clear preset");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/12 bg-black/15 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={14} className="text-primary" />
          <h2 className="text-sm font-semibold">Equalizer preset</h2>
        </div>
        <StateBadge
          hasOwnPreset={hasOwnPreset}
          inherited={inherited}
          resolved={initialResolved}
        />
      </div>

      <p className="mb-4 text-xs leading-5 text-white/55">
        Curve applied when a track in this genre plays with "Genre Adaptive" on.
        Saving stores gains on this taxonomy node directly. Clearing drops back
        to the first ancestor that has a preset.
      </p>

      {/* Band sliders — vertical, same rotate-90 technique as Listen. */}
      <div className="grid grid-cols-10 gap-1.5 rounded-xl border border-white/10 bg-black/30 p-3">
        {EQ_BANDS.map((band, index) => {
          const gainDb = gains[index] ?? 0;
          const pct = ((gainDb - EQ_GAIN_MIN) / range) * 100;
          return (
            <div key={band.freq} className="flex flex-col items-center gap-1">
              <span className="font-mono text-[9px] tabular-nums text-white/60">
                {gainDb > 0 ? `+${gainDb.toFixed(1)}` : gainDb.toFixed(1)}
              </span>
              <div className="relative h-28 w-full">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/20" />
                <input
                  type="range"
                  min={EQ_GAIN_MIN}
                  max={EQ_GAIN_MAX}
                  step={0.5}
                  value={gainDb}
                  aria-label={`${band.label} Hz`}
                  onChange={(e) => updateBand(index, Number(e.target.value))}
                  className="absolute left-1/2 top-1/2 h-1.5 w-28 -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer accent-primary"
                  style={{
                    background: `linear-gradient(to right, rgba(34,211,238,0.3) ${pct}%, rgba(255,255,255,0.05) ${pct}%)`,
                  }}
                />
              </div>
              <span className="font-mono text-[9px] text-white/50">{band.label}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-white/45">
          {dirty ? "Unsaved changes" : "In sync with database"}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setGains([...FLAT_GAINS])}
            disabled={saving || clearing}
            className="text-xs"
          >
            Reset sliders to flat
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={clearPreset}
            disabled={saving || clearing || !hasOwnPreset}
            className="text-xs"
          >
            {clearing ? <Loader2 size={13} className="mr-1 animate-spin" /> : <RotateCcw size={13} className="mr-1" />}
            Clear (inherit)
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saving || clearing || !dirty}
            className="text-xs"
          >
            {saving ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Save size={13} className="mr-1" />}
            Save preset
          </Button>
        </div>
      </div>
    </div>
  );
}

function StateBadge({
  hasOwnPreset,
  inherited,
  resolved,
}: {
  hasOwnPreset: boolean;
  inherited: boolean;
  resolved: ResolvedPreset | null;
}) {
  if (hasOwnPreset) {
    return (
      <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
        Direct preset
      </Badge>
    );
  }
  if (inherited && resolved) {
    return (
      <Badge variant="outline" className="border-white/15 bg-black/15 text-white/80">
        Inherits from {resolved.name}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-100">
      No preset
    </Badge>
  );
}
