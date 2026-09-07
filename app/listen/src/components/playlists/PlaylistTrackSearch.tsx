import { useTranslation } from "react-i18next";
import { Loader2, Search } from "@crate/ui/icons";

import type { SearchTrackResult } from "@/components/playlists/playlist-composer-model";
import { searchTrackKey } from "@/components/playlists/playlist-composer-model";

export function PlaylistTrackSearch({
  search,
  searching,
  results,
  t,
  onSearchChange,
  onAddTrack,
}: {
  search: string;
  searching: boolean;
  results: SearchTrackResult[];
  t: ReturnType<typeof useTranslation>["t"];
  onSearchChange: (value: string) => void;
  onAddTrack: (track: SearchTrackResult) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-border-quiet bg-text-primary/5 px-3 py-2.5">
        <Search size={15} className="text-text-muted" />
        <input
          type="text"
          placeholder={t("playlistComposer.searchPlaceholder")}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="w-full bg-transparent text-base text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        {searching ? (
          <Loader2 size={14} className="text-accent-action animate-spin" />
        ) : null}
      </div>

      {search.trim().length >= 2 ? (
        <div className="rounded-xl border border-border-quiet bg-text-primary/5">
          {results.length > 0 ? (
            <div className="max-h-44 overflow-y-auto py-1.5">
              {results.map((track) => (
                <button
                  key={searchTrackKey(track)}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-text-primary/5"
                  onClick={() => onAddTrack(track)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-text-primary">
                      {track.title}
                    </div>
                    <div className="truncate text-xs text-text-muted">
                      {track.artist} · {track.album}
                    </div>
                  </div>
                  <span className="text-xs text-accent-action">
                    {t("common.add")}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-sm text-text-muted">
              {t("playlistComposer.noTracksFound")}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
