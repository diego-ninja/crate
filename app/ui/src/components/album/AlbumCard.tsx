import React, { useState } from "react";
import { useNavigate } from "react-router";
import { ImageDown, Loader2, Music } from "lucide-react";
import { toast } from "sonner";

import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { CrateChip } from "@/components/ui/CrateBadge";
import { MusicContextMenu } from "@/components/ui/music-context-menu";
import { api } from "@/lib/api";
import { albumCoverApiUrl, albumPagePath } from "@/lib/library-routes";

interface AlbumCardProps {
  albumId?: number;
  albumSlug?: string;
  artist: string;
  artistId?: number;
  artistSlug?: string;
  name: string;
  displayName?: string;
  year?: string;
  tracks: number;
  formats: string[];
  bitDepth?: number | null;
  sampleRate?: number | null;
  hasCover?: boolean;
}

function hashColor(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 30%, 15%)`;
}

function qualityLabel(formats: string[], bitDepth?: number | null, sampleRate?: number | null): { label: string; tier: "hi-res" | "lossless" | "lossy" } | null {
  if (!formats.length) return null;
  const fmt = (formats[0] ?? "").replace(".", "").toLowerCase();
  const fmtUp = fmt.toUpperCase();
  const isLossless = ["flac", "alac", "wav", "aiff"].includes(fmt);
  const depth = bitDepth || 16;
  const rateKhz = sampleRate ? (sampleRate / 1000) : 44.1;
  const rateStr = `${rateKhz % 1 ? rateKhz.toFixed(1) : rateKhz}kHz`;

  if (isLossless && (depth > 16 || rateKhz > 48)) {
    return { label: `${fmtUp} ${depth}/${rateStr}`, tier: "hi-res" };
  }
  if (isLossless) {
    return { label: `${fmtUp} ${depth}/${rateStr}`, tier: "lossless" };
  }
  return { label: fmtUp, tier: "lossy" };
}

export const AlbumCard = React.memo(function AlbumCard({
  albumId,
  albumSlug,
  artist,
  artistId,
  artistSlug,
  name,
  displayName,
  year,
  tracks,
  formats,
  bitDepth,
  sampleRate,
}: AlbumCardProps) {
  const navigate = useNavigate();
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [fetchingCover, setFetchingCover] = useState(false);
  const coverUrl = albumCoverApiUrl({ albumId, albumSlug, artistName: artist, albumName: name });

  async function handleFetchCover(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!albumId || fetchingCover) return;
    setFetchingCover(true);
    try {
      await api(`/api/albums/${albumId}/fetch-cover`, "POST");
      toast.success("Searching for cover...");
      setTimeout(() => {
        setImgError(false);
        setImgLoaded(false);
        setFetchingCover(false);
      }, 8000);
    } catch {
      toast.error("Failed to search for cover");
      setFetchingCover(false);
    }
  }

  return (
    <MusicContextMenu
      type="album"
      artist={artist}
      artistId={artistId}
      artistSlug={artistSlug}
      album={name}
      albumId={albumId}
      albumSlug={albumSlug}
    >
      <div
        onClick={() => navigate(albumPagePath({ albumId, albumSlug, artistName: artist, albumName: name }))}
        className="group cursor-pointer rounded-md p-2 text-left transition-colors hover:bg-white/5"
      >
        <div className="relative mb-3 aspect-square overflow-hidden rounded-md bg-white/5">
          {!imgError ? (
            <img
              src={coverUrl}
              alt={name}
              loading="lazy"
              className={`h-full w-full object-cover transition-opacity duration-300 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
            />
          ) : null}
          {(imgError || !imgLoaded) ? (
            <div
              className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${imgLoaded && !imgError ? "opacity-0" : "opacity-100"}`}
              style={{ background: `linear-gradient(135deg, ${hashColor(name)}, ${hashColor(name + name)})` }}
            >
              <span className="text-3xl font-bold text-white/25">{name.charAt(0).toUpperCase()}</span>
              {!imgError ? <Music size={16} className="absolute bottom-2 right-2 text-white/10" /> : null}
            </div>
          ) : null}

          {imgError && albumId ? (
            <ActionIconButton
              variant="card"
              className="absolute right-2 top-2 opacity-100 md:opacity-0 md:group-hover:opacity-100"
              onClick={handleFetchCover}
              disabled={fetchingCover}
              title="Search for cover"
            >
              {fetchingCover ? <Loader2 size={15} className="animate-spin" /> : <ImageDown size={15} />}
            </ActionIconButton>
          ) : null}
        </div>

        <div className="truncate text-sm font-medium text-foreground">{displayName || name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {year ? `${year} · ${artist}` : artist}
          <span className="ml-1.5 text-white/35">· {tracks} tracks</span>
        </div>
        {formats.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(() => {
              const q = qualityLabel(formats, bitDepth, sampleRate);
              if (!q) return formats.map((f) => <CrateChip key={f}>{f.replace(".", "").toUpperCase()}</CrateChip>);
              return (
                <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none ${
                  q.tier === "hi-res" ? "border-amber-400/50 text-amber-300 bg-amber-400/10" :
                  q.tier === "lossless" ? "border-cyan-400/40 text-cyan-300 bg-cyan-400/8" :
                  "border-white/15 text-muted-foreground"
                }`}>{q.label}</span>
              );
            })()}
          </div>
        ) : null}
      </div>
    </MusicContextMenu>
  );
});
