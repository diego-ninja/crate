import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  Activity,
  AudioLines,
  Gauge,
  HardDrive,
  Loader2,
  Music4,
  Sparkles,
  Star,
  Users,
} from "lucide-react";

import { usePlayer } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import { extractPalette } from "@/lib/palette";
import { cn, formatCompact } from "@/lib/utils";

interface BlissSignature {
  texture: number | null;
  motion: number | null;
  density: number | null;
}

interface TrackInfo {
  title: string | null;
  artist: string | null;
  album: string | null;
  format: string | null;
  bitrate: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
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
  mood_json: Record<string, unknown> | unknown[] | string | null;
  lastfm_listeners: number | null;
  lastfm_playcount: number | null;
  popularity: number | null;
  rating: number | null;
  bliss_signature: BlissSignature | null;
}

type PaletteTriplet = [number, number, number];

function cssColor(color: PaletteTriplet, alpha = 1) {
  const [r, g, b] = color.map((value) => Math.round(value * 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function MetricBar({
  label,
  value,
  tone = "primary",
}: {
  label: string;
  value: number | null;
  tone?: "primary" | "accent" | "warm";
}) {
  if (value == null) return null;

  const percent = Math.max(0, Math.min(value, 1)) * 100;
  const barTone =
    tone === "accent"
      ? "from-cyan-300 to-sky-400"
      : tone === "warm"
        ? "from-amber-300 to-orange-400"
        : "from-primary to-cyan-300";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">{label}</span>
        <span className="text-[11px] font-medium tabular-nums text-white/65">{Math.round(percent)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/6">
        <div
          className={cn("h-full rounded-full bg-gradient-to-r transition-[width]", barTone)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-white">{value}</p>
      {helper ? <p className="mt-1 text-[11px] text-white/45">{helper}</p> : null}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: typeof AudioLines;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[24px] border border-white/8 bg-white/[0.04] shadow-[0_12px_48px_rgba(0,0,0,0.24)]">
      <div className="flex items-start justify-between gap-4 border-b border-white/6 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/42">{title}</p>
          {subtitle ? <p className="mt-1 text-[12px] text-white/45">{subtitle}</p> : null}
        </div>
        <div className="rounded-full border border-white/8 bg-white/[0.05] p-2 text-white/55">
          <Icon size={15} />
        </div>
      </div>
      <div className="space-y-4 px-4 py-4">{children}</div>
    </section>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((score) => (
        <Star
          key={score}
          size={15}
          className={score <= rating ? "fill-amber-400 text-amber-400" : "text-white/12"}
        />
      ))}
    </div>
  );
}

function prettyLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseMoodEntries(input: TrackInfo["mood_json"]) {
  if (!input) return [] as Array<{ label: string; value: number }>;

  let source: unknown = input;
  if (typeof input === "string") {
    try {
      source = JSON.parse(input);
    } catch {
      return [];
    }
  }

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return [];
  }

  return Object.entries(source)
    .map(([label, raw]) => ({
      label: prettyLabel(label),
      value: typeof raw === "number" ? raw : Number.NaN,
    }))
    .filter((entry) => Number.isFinite(entry.value) && entry.value > 0.04)
    .sort((a, b) => b.value - a.value);
}

function formatBitrate(value: number | null | undefined) {
  return value && value > 0 ? `${Math.round(value)} kbps` : null;
}

function formatSampleRate(value: number | null | undefined) {
  return value && value > 0 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} kHz` : null;
}

function formatBitDepth(value: number | null | undefined) {
  return value && value > 0 ? `${value}-bit` : null;
}

function formatKey(audioKey: string | null | undefined, audioScale: string | null | undefined) {
  if (!audioKey) return null;
  const scale = audioScale ? prettyLabel(audioScale) : null;
  return scale ? `${audioKey} ${scale}` : audioKey;
}

export function InfoTab({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { currentTrack } = usePlayer();
  const [info, setInfo] = useState<TrackInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [palette, setPalette] = useState<{
    primary: PaletteTriplet;
    secondary: PaletteTriplet;
    accent: PaletteTriplet;
  } | null>(null);

  useEffect(() => {
    if (!currentTrack?.albumCover) {
      setPalette(null);
      return;
    }

    let cancelled = false;
    extractPalette(currentTrack.albumCover)
      .then(([primary, secondary, accent]) => {
        if (!cancelled) {
          setPalette({ primary, secondary, accent });
        }
      })
      .catch(() => {
        if (!cancelled) setPalette(null);
      });

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.albumCover]);

  useEffect(() => {
    if (!currentTrack) return;
    const controller = new AbortController();

    const resolvedId = currentTrack.libraryTrackId ?? (
      /^\d+$/.test(currentTrack.id) ? Number(currentTrack.id) : null
    );
    const infoUrl = resolvedId != null
      ? `/api/tracks/${resolvedId}/info`
      : currentTrack.storageId
        ? `/api/tracks/by-storage/${encodeURIComponent(currentTrack.storageId)}/info`
        : `/api/track-info/${encodeURIComponent(
            currentTrack.id.startsWith("/music/") ? currentTrack.id.slice(7) : currentTrack.id,
          ).replace(/%2F/g, "/")}`;

    setInfo(null);
    setLoading(true);

    api<TrackInfo>(infoUrl, "GET", undefined, { signal: controller.signal })
      .then((data) => setInfo(data))
      .catch((error) => {
        if (controller.signal.aborted || (error as Error).name === "AbortError") return;
        setInfo(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [currentTrack?.id, currentTrack?.libraryTrackId, currentTrack?.storageId]);

  const moodEntries = useMemo(() => parseMoodEntries(info?.mood_json ?? null), [info?.mood_json]);
  const topMoods = moodEntries.slice(0, 5);

  const audioSummary = useMemo(() => {
    const items: string[] = [];
    if (info?.bpm) items.push(`${Math.round(info.bpm)} BPM`);
    const musicalKey = formatKey(info?.audio_key, info?.audio_scale);
    if (musicalKey) items.push(musicalKey);
    if (info?.format) items.push(String(info.format).toUpperCase());
    return items;
  }, [info?.audio_key, info?.audio_scale, info?.bpm, info?.format]);

  const qualityPills = useMemo(
    () => [
      formatBitrate(info?.bitrate ?? currentTrack?.bitrate),
      formatSampleRate(info?.sample_rate ?? currentTrack?.sampleRate),
      formatBitDepth(info?.bit_depth ?? currentTrack?.bitDepth),
    ].filter(Boolean) as string[],
    [currentTrack?.bitDepth, currentTrack?.bitrate, currentTrack?.sampleRate, info?.bit_depth, info?.bitrate, info?.sample_rate],
  );

  const primary = palette?.primary ?? [0.024, 0.714, 0.831];
  const secondary = palette?.secondary ?? [0.4, 0.9, 1];
  const accent = palette?.accent ?? [0.98, 0.74, 0.24];

  if (loading) {
    return (
      <div className={cn("flex flex-1 items-center justify-center", className)}>
        <Loader2 size={20} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!info || !currentTrack) {
    return (
      <div className={cn("flex flex-1 items-center justify-center text-sm text-white/20", className)}>
        No track info available
      </div>
    );
  }

  const hasAnalysis = [
    info.bpm,
    info.energy,
    info.danceability,
    info.valence,
    info.acousticness,
    info.instrumentalness,
    info.loudness,
    info.dynamic_range,
  ].some((value) => typeof value === "number");

  return (
    <div className={cn("flex-1 overflow-y-auto pr-1", className)}>
      <div className="space-y-4 pb-2">
        <section
          className="relative overflow-hidden rounded-[28px] border border-white/8 px-4 py-4 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:px-5"
          style={{
            background: `linear-gradient(180deg, ${cssColor(primary, 0.2)} 0%, rgba(15,18,26,0.92) 38%, rgba(10,12,18,0.98) 100%)`,
          }}
        >
          <div
            className="pointer-events-none absolute -top-16 -right-12 h-40 w-40 rounded-full blur-3xl"
            style={{ background: cssColor(secondary, 0.3) }}
          />
          <div
            className="pointer-events-none absolute -bottom-12 left-0 h-32 w-32 rounded-full blur-3xl"
            style={{ background: cssColor(accent, 0.18) }}
          />

          <div className="relative flex items-start gap-4">
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[22px] border border-white/10 bg-white/5 shadow-[0_12px_30px_rgba(0,0,0,0.4)] sm:h-28 sm:w-28">
              {currentTrack.albumCover ? (
                <img
                  src={currentTrack.albumCover}
                  alt={`Album cover for ${info.album || currentTrack.album || currentTrack.title}`}
                  width={112}
                  height={112}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-white/25">
                  <Music4 size={28} />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 pt-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Now Inspecting</p>
              <h3 className="mt-1 text-xl font-semibold leading-tight text-white text-balance">
                {info.title || currentTrack.title}
              </h3>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {currentTrack.artistId ? (
                  <button
                    type="button"
                    aria-label={`Open artist ${info.artist || currentTrack.artist}`}
                    onClick={() => navigate(artistPagePath({
                      artistId: currentTrack.artistId,
                      artistSlug: currentTrack.artistSlug,
                      artistName: info.artist || currentTrack.artist,
                    }))}
                    className="min-w-0 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-white/82 transition-colors hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    <span className="block truncate">{info.artist || currentTrack.artist}</span>
                  </button>
                ) : (
                  <span className="truncate text-white/75">{info.artist || currentTrack.artist}</span>
                )}

                {(info.album || currentTrack.album) && currentTrack.albumId ? (
                  <button
                    type="button"
                    aria-label={`Open album ${info.album || currentTrack.album}`}
                    onClick={() => navigate(albumPagePath({
                      albumId: currentTrack.albumId,
                      albumSlug: currentTrack.albumSlug,
                      albumName: info.album || currentTrack.album,
                      artistName: info.artist || currentTrack.artist,
                    }))}
                    className="min-w-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-white/52 transition-colors hover:bg-white/[0.08] hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    <span className="block truncate">{info.album || currentTrack.album}</span>
                  </button>
                ) : info.album || currentTrack.album ? (
                  <span className="truncate text-white/50">{info.album || currentTrack.album}</span>
                ) : null}
              </div>

              {audioSummary.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {audioSummary.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white/68"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {info.rating != null && info.rating > 0 ? (
              <div className="hidden shrink-0 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 sm:block">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Rating</p>
                <div className="mt-2">
                  <StarRating rating={Math.round(info.rating)} />
                </div>
              </div>
            ) : null}
          </div>

          <div className="relative mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {info.bpm ? (
              <StatCard label="Tempo" value={String(Math.round(info.bpm))} helper="BPM" />
            ) : null}
            {formatKey(info.audio_key, info.audio_scale) ? (
              <StatCard label="Key" value={formatKey(info.audio_key, info.audio_scale) ?? "—"} helper="Harmonic center" />
            ) : null}
            {info.popularity != null && info.popularity > 0 ? (
              <StatCard label="Popularity" value={`${Math.round(info.popularity)}%`} helper="Crate score" />
            ) : null}
            {qualityPills.length > 0 ? (
              <StatCard label="Source" value={qualityPills[0]!} helper={qualityPills.slice(1).join(" · ") || "Library file"} />
            ) : null}
          </div>

          {info.rating != null && info.rating > 0 ? (
            <div className="relative mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 sm:hidden">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Rating</p>
                <StarRating rating={Math.round(info.rating)} />
              </div>
            </div>
          ) : null}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            title="Audio Profile"
            subtitle={hasAnalysis ? "Analysis-driven feel of the track." : "No analysis available for this track yet."}
            icon={AudioLines}
          >
            {hasAnalysis ? (
              <>
                <MetricBar label="Energy" value={info.energy} />
                <MetricBar label="Danceability" value={info.danceability} tone="accent" />
                <MetricBar label="Valence" value={info.valence} tone="warm" />
              </>
            ) : (
              <p className="text-sm text-white/40">Analyze more of the library to populate this section.</p>
            )}
          </SectionCard>

          <SectionCard
            title="Mood & Feel"
            subtitle={topMoods.length ? "Dominant mood vectors inferred from the audio." : "No mood profile found yet."}
            icon={Sparkles}
          >
            {topMoods.length ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {topMoods.map((mood) => (
                    <span
                      key={mood.label}
                      className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-cyan-200"
                    >
                      {mood.label} {Math.round(mood.value * 100)}%
                    </span>
                  ))}
                </div>
                <MetricBar label="Acousticness" value={info.acousticness} />
                <MetricBar label="Instrumentalness" value={info.instrumentalness} tone="accent" />
              </>
            ) : (
              <>
                <MetricBar label="Acousticness" value={info.acousticness} />
                <MetricBar label="Instrumentalness" value={info.instrumentalness} tone="accent" />
              </>
            )}
          </SectionCard>

          <SectionCard
            title="Bliss Fingerprint"
            subtitle={info.bliss_signature ? "Texture, motion & density derived from the similarity vector." : "Fingerprint not available yet."}
            icon={Activity}
          >
            {info.bliss_signature ? (
              <>
                <MetricBar label="Texture" value={info.bliss_signature.texture} />
                <MetricBar label="Motion" value={info.bliss_signature.motion} tone="accent" />
                <MetricBar label="Density" value={info.bliss_signature.density} tone="warm" />
              </>
            ) : (
              <p className="text-sm text-white/40">Bliss analysis has not been computed for this track yet.</p>
            )}
          </SectionCard>

          <SectionCard
            title="Source & Dynamics"
            subtitle="File quality plus loudness and dynamic range where available."
            icon={HardDrive}
          >
            <div className="grid grid-cols-2 gap-3">
              {qualityPills.map((pill) => (
                <StatCard key={pill} label="File" value={pill} />
              ))}
              {info.loudness != null ? (
                <StatCard label="Loudness" value={`${info.loudness.toFixed(1)} dB`} helper="Integrated level" />
              ) : null}
              {info.dynamic_range != null ? (
                <StatCard label="Dynamics" value={`${info.dynamic_range.toFixed(1)} dB`} helper="Dynamic range" />
              ) : null}
            </div>
            {!qualityPills.length && info.loudness == null && info.dynamic_range == null ? (
              <p className="text-sm text-white/40">No format or dynamics data available.</p>
            ) : null}
          </SectionCard>
        </div>

        <SectionCard
          title="Reach"
          subtitle="Signals collected from Last.fm and Crate popularity scoring."
          icon={Users}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {info.lastfm_listeners != null && info.lastfm_listeners > 0 ? (
              <StatCard label="Listeners" value={formatCompact(info.lastfm_listeners)} helper="Last.fm audience" />
            ) : null}
            {info.lastfm_playcount != null && info.lastfm_playcount > 0 ? (
              <StatCard label="Plays" value={formatCompact(info.lastfm_playcount)} helper="Last.fm scrobbles" />
            ) : null}
            {info.popularity != null && info.popularity > 0 ? (
              <StatCard label="Popularity" value={`${Math.round(info.popularity)}%`} helper="Normalized score" />
            ) : null}
          </div>
          {!(info.lastfm_listeners || info.lastfm_playcount || info.popularity) ? (
            <p className="text-sm text-white/40">No popularity signals are available for this track yet.</p>
          ) : null}
        </SectionCard>

        {info.loudness != null || info.dynamic_range != null ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {info.loudness != null ? (
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Loudness</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-white">{info.loudness.toFixed(1)} dB</p>
                  </div>
                  <Gauge size={18} className="text-white/45" />
                </div>
              </div>
            ) : null}

            {info.dynamic_range != null ? (
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Dynamic Range</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-white">{info.dynamic_range.toFixed(1)} dB</p>
                  </div>
                  <Activity size={18} className="text-white/45" />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
