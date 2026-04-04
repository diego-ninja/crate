import { useEffect, useState } from "react";
import { Loader2, Star } from "lucide-react";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { formatCompact } from "@/lib/utils";

interface TrackInfo {
  title: string;
  artist: string;
  album: string;
  bpm: number | null;
  audio_key: string | null;
  audio_scale: string | null;
  energy: number | null;
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  loudness: number | null;
  dynamic_range: number | null;
  lastfm_listeners: number | null;
  lastfm_playcount: number | null;
  popularity: number | null;
  rating: number | null;
}

function MetricBar({ label, value }: { label: string; value: number | null }) {
  const normalizedValue = value ?? 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[11px] text-white/40">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-primary/70 transition-all"
          style={{ width: `${Math.min(normalizedValue * 100, 100)}%` }}
        />
      </div>
      <span className="w-8 text-right text-[10px] tabular-nums text-white/30">
        {(normalizedValue * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((score) => (
        <Star
          key={score}
          size={14}
          className={score <= rating ? "fill-amber-400 text-amber-400" : "text-white/10"}
        />
      ))}
    </div>
  );
}

export function InfoTab() {
  const { currentTrack } = usePlayerActions();
  const [info, setInfo] = useState<TrackInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentTrack) return;
    const controller = new AbortController();
    const trackPath = currentTrack.id.startsWith("/music/")
      ? currentTrack.id.slice(7)
      : currentTrack.id;

    setInfo(null);
    setLoading(true);

    api<TrackInfo>(
      `/api/track-info/${encodeURIComponent(trackPath).replace(/%2F/g, "/")}`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((data) => setInfo(data))
      .catch((error) => {
        if (controller.signal.aborted || (error as Error).name === "AbortError") return;
        setInfo(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [currentTrack?.id]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-white/20">
        No track info available
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-5 overflow-y-auto py-1 pr-1">
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/25">Track</p>
        <p className="text-[13px] font-medium text-white">{info.title}</p>
        <p className="text-[11px] text-white/50">{info.artist}</p>
        <p className="text-[11px] text-white/30">{info.album}</p>
      </div>

      {(info.bpm || info.audio_key) && (
        <div>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-white/25">Audio Analysis</p>
          <div className="mb-4 flex items-baseline gap-4">
            {info.bpm ? (
              <div>
                <span className="text-2xl font-bold tabular-nums text-white">{Math.round(info.bpm)}</span>
                <span className="ml-1 text-[10px] text-white/30">BPM</span>
              </div>
            ) : null}
            {info.audio_key ? (
              <div>
                <span className="text-lg font-semibold text-white">{info.audio_key}</span>
                {info.audio_scale ? (
                  <span className="ml-1 text-[11px] text-white/40">{info.audio_scale}</span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="space-y-2.5">
            <MetricBar label="Energy" value={info.energy} />
            <MetricBar label="Danceability" value={info.danceability} />
            <MetricBar label="Valence" value={info.valence} />
          </div>
        </div>
      )}

      {(info.acousticness !== null || info.instrumentalness !== null) && (
        <div>
          <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-white/25">Mood Profile</p>
          <div className="space-y-2.5">
            <MetricBar label="Acousticness" value={info.acousticness} />
            <MetricBar label="Instrumentalness" value={info.instrumentalness} />
          </div>
        </div>
      )}

      {(info.loudness !== null || info.dynamic_range !== null) && (
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/25">Dynamics</p>
          <div className="flex gap-6">
            {info.loudness !== null ? (
              <div>
                <span className="text-sm font-semibold tabular-nums text-white">{info.loudness.toFixed(1)}</span>
                <span className="ml-1 text-[10px] text-white/30">dB LUFS</span>
              </div>
            ) : null}
            {info.dynamic_range !== null ? (
              <div>
                <span className="text-sm font-semibold tabular-nums text-white">
                  {info.dynamic_range.toFixed(1)}
                </span>
                <span className="ml-1 text-[10px] text-white/30">dB DR</span>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {(info.lastfm_listeners || info.lastfm_playcount) && (
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/25">Popularity</p>
          <div className="flex gap-6">
            {info.lastfm_listeners != null && info.lastfm_listeners > 0 ? (
              <div>
                <span className="text-sm font-semibold tabular-nums text-white">
                  {formatCompact(info.lastfm_listeners)}
                </span>
                <span className="ml-1 text-[10px] text-white/30">listeners</span>
              </div>
            ) : null}
            {info.lastfm_playcount != null && info.lastfm_playcount > 0 ? (
              <div>
                <span className="text-sm font-semibold tabular-nums text-white">
                  {formatCompact(info.lastfm_playcount)}
                </span>
                <span className="ml-1 text-[10px] text-white/30">plays</span>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {info.rating != null && info.rating > 0 ? (
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/25">Rating</p>
          <StarRating rating={Math.round(info.rating)} />
        </div>
      ) : null}
    </div>
  );
}
