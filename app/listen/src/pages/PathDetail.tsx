import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Loader2, Play, RefreshCw, Trash2 } from "@crate/ui/icons";
import { toast } from "sonner";

import { CrateLoader } from "@/components/ui/CrateLoader";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { PathRouteVisualization, PathTrackList } from "./PathDetailParts";
import type { PathDetail as PathData, PathTrack } from "./paths-model";

function mapToPlayerTrack(track: PathTrack): Track {
  return toPlayableTrack(track, {
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
  });
}

export function PathDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: path, loading, refetch } = useApi<PathData>(`/api/paths/${id}`);
  const { playAll, currentTrack } = usePlayerActions();
  const [regenerating, setRegenerating] = useState(false);
  const [animate, setAnimate] = useState(true);
  const activeTrackRef = useRef<HTMLDivElement>(null);

  const activeStep =
    path?.tracks.findIndex(
      (track) => currentTrack?.libraryTrackId === track.track_id,
    ) ?? -1;

  const playFromStep = useCallback(
    (startIndex: number) => {
      if (!path) return;
      playAll(path.tracks.map(mapToPlayerTrack), startIndex, {
        type: "playlist",
        name: path.name,
        id: path.id,
      });
    },
    [path, playAll],
  );

  const regenerate = async () => {
    if (!path || regenerating) return;
    setRegenerating(true);
    try {
      await api(`/api/paths/${path.id}/regenerate`, "POST");
      toast.success(t("paths.toasts.regenerated"));
      refetch();
    } catch {
      toast.error(t("paths.toasts.regenerateFailed"));
    } finally {
      setRegenerating(false);
    }
  };

  useEffect(() => {
    activeTrackRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [activeStep]);

  useEffect(() => {
    setAnimate(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)));
  }, []);

  if (loading || !path) {
    return <CrateLoader label={t("paths.loadingDetail")} />;
  }

  return (
    <div className="animate-page-in px-4  sm:p-6">
      <button
        onClick={() => navigate("/paths")}
        className="mb-5 flex items-center gap-1.5 text-sm text-text-primary/40 transition hover:text-text-primary"
      >
        <ArrowLeft size={14} /> {t("paths.back")}
      </button>

      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{path.name}</h1>
          <div className="mt-1.5 flex items-center gap-2 text-[0.75rem] text-text-primary/40">
            <span className="font-medium text-accent-action/70">
              {path.origin.label}
            </span>
            <span className="text-text-primary/15">→</span>
            <span className="font-medium text-accent-action/70">
              {path.destination.label}
            </span>
            <span className="text-text-primary/15">·</span>
            <span>
              {t("common.trackCountLabel", { count: path.tracks.length })}
            </span>
          </div>
        </div>
        <button
          onClick={() => playFromStep(0)}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-action text-accent-action-foreground shadow-accent-action-strong transition hover:bg-accent-action/90"
        >
          <Play size={18} className="ml-0.5 fill-current" />
        </button>
      </div>

      <PathRouteVisualization
        path={path}
        activeStep={activeStep}
        animate={animate}
        onPlayFromStep={playFromStep}
      />

      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => void regenerate()}
          disabled={regenerating}
          className="flex items-center gap-1.5 rounded-full border border-border-quiet bg-text-primary/5 px-3 py-1.5 text-xs font-medium text-text-primary/60 transition hover:border-text-primary/20 hover:text-text-primary disabled:opacity-30"
        >
          {regenerating ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <RefreshCw size={11} />
          )}
          {t("paths.regenerate")}
        </button>
        <button
          onClick={async () => {
            await api(`/api/paths/${path.id}`, "DELETE");
            toast.success(t("paths.toasts.deleted"));
            navigate("/paths");
          }}
          className="flex items-center gap-1.5 rounded-full border border-border-quiet bg-text-primary/5 px-3 py-1.5 text-xs font-medium text-text-primary/60 transition hover:border-state-danger/30 hover:text-state-danger-text"
        >
          <Trash2 size={11} /> {t("common.delete")}
        </button>
      </div>

      <PathTrackList
        path={path}
        activeStep={activeStep}
        activeTrackRef={activeTrackRef}
        onPlayFromStep={playFromStep}
      />
    </div>
  );
}
