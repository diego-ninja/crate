import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { ArrowRight, Loader2, Route } from "@crate/ui/icons";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { EndpointPanel, PathCard } from "./PathsParts";
import type { PathDetail, PathSummary, SearchResult } from "./paths-model";

export function Paths() {
  const { t } = useTranslation();
  const { data: paths, refetch } = useApi<PathSummary[]>("/api/paths");
  const { playAll } = usePlayerActions();
  const navigate = useNavigate();
  const [origin, setOrigin] = useState<SearchResult | null>(null);
  const [destination, setDestination] = useState<SearchResult | null>(null);
  const [steps, setSteps] = useState(20);
  const [creating, setCreating] = useState(false);

  const canCreate = origin && destination && !creating;

  const create = async () => {
    if (!origin || !destination) return;
    setCreating(true);
    try {
      const result = await api<PathDetail>("/api/paths", "POST", {
        origin: { type: origin.type, value: origin.value },
        destination: { type: destination.type, value: destination.value },
        step_count: steps,
      });
      toast.success(t("paths.toasts.created", { name: result.name }));
      refetch();
      navigate(`/paths/${result.id}`);
    } catch {
      toast.error(t("paths.toasts.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const playPath = async (pathId: number) => {
    try {
      const detail = await api<PathDetail>(`/api/paths/${pathId}`);
      const tracks: Track[] = detail.tracks.map((track) =>
        toPlayableTrack(track, {
          cover:
            track.album_id || track.album_entity_uid
              ? albumCoverApiUrl(
                  {
                    albumId: track.album_id,
                    albumEntityUid: track.album_entity_uid,
                    artistEntityUid: track.artist_entity_uid,
                  },
                  { size: 512 },
                )
              : undefined,
        }),
      );
      playAll(tracks, 0, {
        type: "playlist",
        name: detail.name,
        id: detail.id,
      });
    } catch {
      toast.error(t("paths.toasts.loadFailed"));
    }
  };

  const deletePath = async (pathId: number) => {
    try {
      await api(`/api/paths/${pathId}`, "DELETE");
      toast.success(t("paths.toasts.deleted"));
      refetch();
    } catch {
      toast.error(t("paths.toasts.deleteFailed"));
    }
  };

  return (
    <div className="animate-page-in space-y-6 px-4  sm:p-6">
      <div className="flex items-center gap-3">
        <Route size={22} className="text-accent-action" />
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            {t("paths.title")}
          </h1>
          <p className="text-[0.8125rem] text-text-primary/40">
            {t("paths.subtitle")}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <EndpointPanel side="origin" selected={origin} onSelect={setOrigin} />
        <div className="flex items-center justify-center sm:py-8">
          <ArrowRight
            size={20}
            className="rotate-90 text-accent-action/40 sm:rotate-0"
          />
        </div>
        <EndpointPanel
          side="destination"
          selected={destination}
          onSelect={setDestination}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="flex-1">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-primary/35">
            {t("paths.length")}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              aria-label={t("paths.length")}
              min={5}
              max={50}
              value={steps}
              onChange={(event) => setSteps(Number(event.target.value))}
              className="flex-1 accent-primary"
            />
            <span className="w-16 text-right font-mono text-[0.75rem] tabular-nums text-text-primary/50">
              {t("common.trackCountLabel", { count: steps })}
            </span>
          </div>
        </div>
        <button
          onClick={create}
          disabled={!canCreate}
          className="flex items-center justify-center gap-2 rounded-lg bg-accent-action px-6 py-3 text-sm font-semibold text-accent-action-foreground shadow-accent-action transition hover:bg-accent-action/90 disabled:opacity-25 disabled:shadow-none"
        >
          {creating ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Route size={15} />
          )}
          {t("paths.compute")}
        </button>
      </div>

      {paths && paths.length > 0 ? (
        <div className="space-y-2 pt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-primary/30">
            {t("paths.saved")}
          </div>
          {paths.map((path) => (
            <PathCard
              key={path.id}
              path={path}
              onPlay={() => void playPath(path.id)}
              onDelete={() => void deletePath(path.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
