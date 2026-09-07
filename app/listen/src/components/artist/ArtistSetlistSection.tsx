import { ListMusic, Play, Save, X } from "@crate/ui/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AppModal } from "@crate/ui/primitives/AppModal";
import { api } from "@/lib/api";

interface SetlistTrack {
  title: string;
  frequency: number;
  play_count: number;
  last_played?: string;
}

interface ArtistSetlistModalProps {
  artistName: string;
  artistId?: number;
  setlist: SetlistTrack[];
  open: boolean;
  onClose: () => void;
  onPlay: () => void;
}

export function ArtistSetlistModal({
  artistName,
  artistId,
  setlist,
  open,
  onClose,
  onPlay,
}: ArtistSetlistModalProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  async function handleExport() {
    if (!artistId) return;
    setSaving(true);
    try {
      await api(`/api/artists/${artistId}/setlist-playlist`, "POST");
      toast.success(t("artist.setlist.toasts.exported"));
    } catch {
      toast.error(t("artist.setlist.toasts.exportFailed"));
    } finally {
      setSaving(false);
    }
  }

  function handlePlay() {
    onPlay();
    onClose();
  }

  return (
    <AppModal
      open={open}
      onClose={onClose}
      maxWidthClassName="max-w-md"
      mobileSafeArea
      overlayClassName="bg-surface-canvas/58"
      panelClassName="listen-glass-panel flex min-h-0 flex-col overflow-hidden border-0 pb-4 sm:max-h-[92vh]"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-text-primary/5 px-5 py-4">
          <div className="flex items-center gap-3">
            <ListMusic size={18} className="text-accent-action" />
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                {t("artist.setlist.title")}
              </h3>
              <p className="text-xs text-text-muted">
                {artistName} ·{" "}
                {t("artist.setlist.songCount", { count: setlist.length })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-text-primary/40 transition-colors hover:bg-text-primary/10 hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>

        {/* Track list */}
        <div className="flex-1 overflow-y-auto p-2 ">
          {setlist.map((track, i) => (
            <div
              key={[
                track.title,
                track.last_played ?? "",
                track.frequency,
                track.play_count,
              ].join(":")}
              className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-text-primary/[0.03]"
            >
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-text-primary/20">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text-primary">
                  {track.title}
                </span>
                <div className="mt-1 flex items-center gap-2">
                  <div className="relative h-1 w-16 rounded-full bg-accent-action/15">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-accent-action/70"
                      style={{ width: `${Math.round(track.frequency * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-text-primary/40">
                    {Math.round(track.frequency * 100)}%
                  </span>
                  {track.play_count > 0 && (
                    <span className="text-xs text-text-primary/20">
                      {t("common.playCount", { count: track.play_count })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-t border-text-primary/5 px-5 py-4">
          <button
            onClick={handlePlay}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent-action/15 py-2.5 text-sm font-medium text-accent-action transition-colors hover:bg-accent-action/25"
          >
            <Play size={14} fill="currentColor" />
            {t("artist.setlist.play")}
          </button>
          <button
            onClick={handleExport}
            disabled={saving || !artistId}
            className="flex items-center justify-center gap-2 rounded-lg border border-border-quiet px-4 py-2.5 text-sm text-text-primary transition-colors hover:bg-text-primary/5 disabled:opacity-40"
          >
            <Save size={14} />
            {saving ? t("common.saving") : t("artist.setlist.export")}
          </button>
        </div>
      </div>
    </AppModal>
  );
}
