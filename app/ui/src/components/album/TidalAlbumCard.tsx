import { useState } from "react";
import { Download, Loader2, Check } from "lucide-react";
import { api } from "@/lib/api";
import { tidalDownloadMissingArtistApiPath } from "@/lib/library-routes";
import { toast } from "sonner";

interface TidalAlbumCardProps {
  artist: string;
  artistId: number;
  artistEntityUid?: string;
  title: string;
  year: string;
  tracks: number;
  cover: string | null;
  url: string;
}

export function TidalAlbumCard({ artist: _artist, artistId, artistEntityUid, title, year, tracks, cover, url }: TidalAlbumCardProps) {
  const [status, setStatus] = useState<"idle" | "downloading" | "queued">("idle");

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (status !== "idle") return;
    setStatus("downloading");
    try {
      await api(tidalDownloadMissingArtistApiPath({ artistId, artistEntityUid }), "POST", {
        albums: [{ url, title, cover_url: cover }],
      });
      setStatus("queued");
      toast.success(`Queued: ${title}`);
    } catch {
      setStatus("idle");
      toast.error(`Failed to queue ${title}`);
    }
  }

  return (
    <div className="border border-dashed border-primary/20 rounded-md p-3 text-center group">
      <div className="w-full aspect-square rounded-md overflow-hidden mb-2 relative bg-secondary">
        {cover ? (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            className="w-full h-full object-cover grayscale opacity-50"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-card">
            <span className="text-3xl font-bold text-white/10">{title.charAt(0).toUpperCase()}</span>
          </div>
        )}
        {/* Download overlay */}
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {status === "idle" && (
            <button
              onClick={handleDownload}
              className="w-11 h-11 rounded-md bg-primary flex items-center justify-center shadow-lg shadow-black/40 hover:bg-primary/80 transition-colors hover:scale-110"
            >
              <Download size={20} className="text-white" />
            </button>
          )}
          {status === "downloading" && (
            <div className="w-11 h-11 rounded-md bg-primary/50 flex items-center justify-center">
              <Loader2 size={20} className="text-white animate-spin" />
            </div>
          )}
        </div>
        {status === "queued" && (
          <div className="absolute top-2 right-2 z-10">
            <Check size={14} className="text-primary drop-shadow-md" />
          </div>
        )}
      </div>
      <div className="font-semibold text-sm text-left truncate text-muted-foreground">{title}</div>
      <div className="text-xs text-muted-foreground/60 text-left flex items-center gap-1 mt-0.5">
        <span>{year || "?"}</span>
        <span>&middot;</span>
        <span>{tracks}t</span>
        <span className="ml-auto text-primary/60 text-[10px]">Tidal</span>
      </div>
    </div>
  );
}
