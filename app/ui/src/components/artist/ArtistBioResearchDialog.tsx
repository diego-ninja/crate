import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { Textarea } from "@crate/ui/shadcn/textarea";
import { Button } from "@crate/ui/shadcn/button";

import { api } from "@/lib/api";
import { artistActionApiPath } from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";
import type { ArtistData } from "./artistPageTypes";

interface ResearchSource {
  id: string;
  title: string;
  url: string;
  kind: string;
  excerpt: string;
}

interface ResearchResult {
  proposal: string;
  claims?: { claim: string; source_ids: string[] }[];
  conflicts?: string[];
  warnings?: string[];
  sources?: ResearchSource[];
  model?: string;
}

interface ArtistBioResearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artist: ArtistData;
  currentBio: string;
  onApply: (bio: string) => Promise<void> | void;
}

export function ArtistBioResearchDialog({
  open,
  onOpenChange,
  artist,
  currentBio,
  onApply,
}: ArtistBioResearchDialogProps) {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [proposal, setProposal] = useState("");

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setProposal("");
    setError(null);
    void runResearch();
    // The dialog is intentionally a fresh research run each time it opens.
  }, [open, artist.id, artist.entity_uid]);

  async function runResearch() {
    setLoading(true);
    setError(null);
    try {
      const endpoint = artistActionApiPath(
        { artistId: artist.id, artistEntityUid: artist.entity_uid },
        "bio/research",
      );
      if (!endpoint) throw new Error("Artist reference missing");
      const queued = await api<{ task_id: string }>(endpoint, "POST", {
        language: "English",
      });
      const task = await waitForTask(queued.task_id, 10 * 60 * 1000);
      if (task.status !== "completed" || !task.result) {
        throw new Error(task.error || "Research task failed");
      }
      const nextResult = task.result as unknown as ResearchResult;
      setResult(nextResult);
      setProposal(nextResult.proposal || "");
    } catch (nextError) {
      if (nextError instanceof DOMException && nextError.name === "AbortError")
        return;
      const message =
        nextError instanceof Error ? nextError.message : "Research failed";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function applyProposal() {
    const value = proposal.trim();
    if (!value) return;
    setApplying(true);
    try {
      await onApply(value);
      toast.success("Biography proposal applied");
      onOpenChange(false);
    } catch (nextError) {
      toast.error(
        nextError instanceof Error
          ? nextError.message
          : "Failed to apply biography",
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(86vh,860px)] max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Research biography with AI</DialogTitle>
          <DialogDescription>
            Internet sources are collected and consolidated into an editable
            proposal for {artist.name}. Nothing is saved until you apply it.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-5 text-sm text-white/70">
              <Loader2 className="animate-spin text-primary" size={18} />
              Searching MusicBrainz, Wikipedia, Last.fm and official pages, then
              consolidating evidence…
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-3 rounded-lg border border-red-400/25 bg-red-500/5 p-4 text-sm text-red-200">
              <AlertTriangle size={17} className="mt-0.5 shrink-0" />
              <div className="space-y-2">
                <p>{error}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void runResearch()}
                >
                  <RefreshCw size={14} className="mr-2" /> Retry research
                </Button>
              </div>
            </div>
          ) : null}

          {result ? (
            <>
              <p className="text-xs text-white/40">
                Current library bio:{" "}
                {currentBio.trim()
                  ? `${currentBio.trim().length} characters`
                  : "empty"}
              </p>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-white/75">
                    Proposed biography
                  </span>
                  <Textarea
                    value={proposal}
                    onChange={(event) => setProposal(event.target.value)}
                    rows={12}
                    className="min-h-64 resize-y leading-relaxed"
                  />
                </label>
                <div className="space-y-3">
                  <div>
                    <p className="mb-2 text-sm font-medium text-white/75">
                      Evidence used
                    </p>
                    <div className="space-y-2">
                      {(result.sources ?? []).map((source) => (
                        <a
                          key={source.id}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="block rounded-md border border-white/10 bg-black/20 p-3 transition-colors hover:border-primary/40"
                        >
                          <span className="flex items-center gap-2 text-xs font-medium text-primary">
                            {source.title} <ExternalLink size={11} />
                          </span>
                          <span className="mt-1 block line-clamp-3 text-xs leading-relaxed text-white/45">
                            {source.excerpt}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                  {result.conflicts?.length || result.warnings?.length ? (
                    <div className="rounded-md border border-amber-400/20 bg-amber-500/5 p-3 text-xs text-amber-100/75">
                      <p className="mb-1 font-medium text-amber-200">
                        Review notes
                      </p>
                      {[
                        ...(result.conflicts ?? []),
                        ...(result.warnings ?? []),
                      ].map((note) => (
                        <p key={note} className="mt-1">
                          {note}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <p className="text-xs text-white/35">
                Model: {result.model || "configured provider"}. Existing
                biography was supplied as context only; claims should be checked
                against the linked sources.
              </p>
            </>
          ) : null}
          {!loading && !result && !error ? (
            <p className="text-sm text-white/45">
              Preparing research for {artist.name}…
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={applying}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void applyProposal()}
            disabled={!result || !proposal.trim() || applying}
          >
            {applying ? (
              <Loader2 size={14} className="mr-2 animate-spin" />
            ) : null}
            Apply proposal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
