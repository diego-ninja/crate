import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Save, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AIButton } from "@/components/ui/AIButton";
import { Button } from "@crate-ui/shadcn/button";
import { api } from "@/lib/api";
import { EqBands } from "@crate-ui/domain/player/EqBands";
import { Badge } from "@crate-ui/shadcn/badge";
import { useLLMAvailable } from "@/hooks/use-llm";

const EQ_BAND_COUNT = 10;
const FLAT_GAINS: number[] = new Array(EQ_BAND_COUNT).fill(0);

interface ResolvedPreset {
  gains: number[];
  source: "direct" | "inherited";
  slug: string;
  name: string;
}

interface Props {
  canonicalSlug: string;
  canonicalName: string;
  initialGains: number[] | null;
  initialResolved: ResolvedPreset | null;
  eqReasoning?: string | null;
  onSaved?: () => void;
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > 0.001) return false;
  }
  return true;
}

export function GenreEqEditor({
  canonicalSlug,
  canonicalName,
  initialGains,
  initialResolved,
  eqReasoning,
  onSaved,
}: Props) {
  const seeded = useMemo<number[]>(() => {
    if (initialGains && initialGains.length === EQ_BAND_COUNT) return [...initialGains];
    if (initialResolved?.gains.length === EQ_BAND_COUNT) return [...initialResolved.gains];
    return [...FLAT_GAINS];
  }, [initialGains, initialResolved]);

  const [gains, setGains] = useState<number[]>(seeded);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reasoning, setReasoning] = useState(eqReasoning || "");
  const llmAvailable = useLLMAvailable();

  useEffect(() => { setGains(seeded); }, [seeded]);

  const dirty = !arraysEqual(gains, seeded);
  const hasOwnPreset = initialGains !== null;
  const inherited = !hasOwnPreset && initialResolved?.source === "inherited";

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

  const generateWithAI = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const result = await api<{ gains: number[]; reasoning: string }>(`/api/genres/${canonicalSlug}/generate-eq?apply=true`, "POST");
      setGains(result.gains);
      setReasoning(result.reasoning);
      toast.success(`AI generated EQ for ${canonicalName}`);
      onSaved?.();
    } catch {
      toast.error("AI generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="rounded-md border border-white/12 bg-black/15 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={14} className="text-primary" />
          <h2 className="text-sm font-semibold">Equalizer preset</h2>
        </div>
        {hasOwnPreset ? (
          <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">Direct preset</Badge>
        ) : inherited && initialResolved ? (
          <Badge variant="outline" className="border-white/15 bg-black/15 text-white/80">Inherits from {initialResolved.name}</Badge>
        ) : (
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-100">No preset</Badge>
        )}
      </div>

      <p className="mb-4 text-xs leading-5 text-white/55">
        {reasoning || "Curve applied when a track in this genre plays with \"Genre Adaptive\" on. Saving stores gains on this taxonomy node directly. Clearing drops back to the first ancestor that has a preset."}
      </p>

      <div className="rounded-md border border-white/10 bg-black/30 p-3">
        <EqBands
          gains={gains}
          onBandChange={updateBand}
          trackHeight={112}
        />
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
          {llmAvailable && (
            <AIButton
              onClick={generateWithAI}
              loading={generating}
              disabled={saving || clearing}
            >
              Generate with AI
            </AIButton>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={clearPreset}
            disabled={saving || clearing || generating || !hasOwnPreset}
            className="text-xs"
          >
            {clearing ? <Loader2 size={13} className="mr-1 animate-spin" /> : <RotateCcw size={13} className="mr-1" />}
            Clear (inherit)
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saving || clearing || generating || !dirty}
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
