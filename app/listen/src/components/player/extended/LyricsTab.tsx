import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "@crate/ui/icons";

import { usePlayerActions, usePlayerProgress } from "@/contexts/PlayerContext";

import { LyricsLine } from "./LyricsLine";
import { useLyrics } from "./use-lyrics";

export function LyricsTab({ useAlbumPalette }: { useAlbumPalette: boolean }) {
  void useAlbumPalette;
  const { t } = useTranslation();
  const { currentTime } = usePlayerProgress();
  const { currentTrack, seek } = usePlayerActions();
  const { lyrics, loading } = useLyrics(currentTrack);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const activeIndex = useMemo(() => {
    if (!lyrics?.synced) return -1;
    for (let i = lyrics.synced.length - 1; i >= 0; i--) {
      if (currentTime >= lyrics.synced[i]!.time) return i;
    }
    return -1;
  }, [currentTime, lyrics?.synced]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-accent-action" />
      </div>
    );
  }

  if (!lyrics?.synced && !lyrics?.plain) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-faint">
        {t("player.lyrics.empty")}
      </div>
    );
  }

  return (
    <div className="lyrics-mask lyrics-surface-gradient relative flex-1 overflow-y-auto pr-1">
      {lyrics.synced ? (
        <div
          className="space-y-1 px-1"
          style={{ paddingTop: "34vh", paddingBottom: "34vh" }}
        >
          {lyrics.synced.map((line, index) => (
            <LyricsLine
              key={[line.time, line.text].join(":")}
              line={line}
              index={index}
              activeIndex={activeIndex}
              activeRef={activeRef}
              onSeek={seek}
            />
          ))}
        </div>
      ) : null}

      {!lyrics.synced && lyrics.plain ? (
        <pre className="whitespace-pre-wrap py-2 font-sans text-[0.875rem] leading-relaxed text-text-muted">
          {lyrics.plain}
        </pre>
      ) : null}
    </div>
  );
}
