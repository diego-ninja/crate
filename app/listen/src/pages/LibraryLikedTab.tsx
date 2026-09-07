import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Play, Search } from "@crate/ui/icons";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { WindowVirtualList } from "@/components/ui/WindowVirtualList";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { toTrackRowData } from "@/lib/track-row-data";

import { CollectionSortDropdown } from "./LibraryCollectionSortDropdown";
import { EmptyState, Spinner } from "./LibraryPrimitives";
import { likedSortOptions, type LikedSort } from "./library-collection-model";

export function LibraryLikedTab() {
  const { t } = useTranslation();
  const { likedTracks: tracks, loading } = useLikedTracks();
  const { playAll } = usePlayerActions();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<LikedSort>("recent");

  const filtered = useMemo(() => {
    if (!tracks) return [];
    let list = [...tracks];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (track) =>
          track.title?.toLowerCase().includes(q) ||
          track.artist?.toLowerCase().includes(q) ||
          track.album?.toLowerCase().includes(q),
      );
    }
    if (sort === "title")
      list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    else if (sort === "artist")
      list.sort((a, b) => (a.artist || "").localeCompare(b.artist || ""));
    else if (sort === "album")
      list.sort((a, b) => (a.album || "").localeCompare(b.album || ""));
    return list;
  }, [tracks, search, sort]);

  const trackRows = useMemo<TrackRowData[]>(
    () =>
      filtered.map((track) =>
        toTrackRowData({
          ...track,
          id:
            track.track_id ?? track.relative_path ?? track.path ?? track.title,
          path: track.relative_path || track.path,
          library_track_id: track.track_id,
        }),
      ),
    [filtered],
  );

  if (loading) return <Spinner />;
  if (!tracks || tracks.length === 0) {
    return <EmptyState message={t("library.liked.empty")} />;
  }

  function handlePlayAll() {
    const list = filtered.length ? filtered : tracks;
    const playerTracks: Track[] = list.map((track) =>
      toPlayableTrack(
        {
          ...track,
          id:
            track.track_id ?? track.relative_path ?? track.path ?? track.title,
          path: track.relative_path || track.path,
          library_track_id: track.track_id,
        },
        {
          cover:
            track.artist && track.album
              ? albumCoverApiUrl(
                  {
                    albumId: track.album_id,
                    albumEntityUid: track.album_entity_uid,
                    artistEntityUid: track.artist_entity_uid,
                    albumSlug: track.album_slug,
                    artistName: track.artist,
                    albumName: track.album,
                  },
                  { size: 512 },
                )
              : undefined,
        },
      ),
    );
    playAll(playerTracks, 0);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handlePlayAll}
          className="flex items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90"
        >
          <Play size={16} fill="currentColor" />
          {filtered.length < tracks.length
            ? t("library.liked.playFiltered", { count: filtered.length })
            : t("library.liked.playAll")}
        </button>
        <div className="relative min-w-[180px] flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-primary/40"
          />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("library.liked.filterPlaceholder")}
            className="h-10 w-full rounded-lg bg-text-primary/5 pl-9 pr-3 text-base text-text-primary outline-none placeholder:text-text-primary/40 focus:bg-text-primary/8"
          />
        </div>
        <CollectionSortDropdown
          label={t("library.sort.likedTracks")}
          value={sort}
          options={likedSortOptions}
          onChange={setSort}
        />
      </div>
      <WindowVirtualList
        items={trackRows}
        estimateSize={72}
        itemKey={(row, index) =>
          row.id ??
          row.path ??
          row.artist + "-" + row.album + "-" + row.title + "-" + index
        }
        renderItem={(row, index) => (
          <TrackRow
            track={row}
            index={index + 1}
            showArtist
            showAlbum
            albumCover={
              row.artist && row.album
                ? albumCoverApiUrl(
                    {
                      albumId: row.album_id,
                      albumEntityUid: row.album_entity_uid,
                      artistEntityUid: row.artist_entity_uid,
                      albumSlug: row.album_slug,
                      artistName: row.artist,
                      albumName: row.album,
                    },
                    { size: 128 },
                  )
                : undefined
            }
            showCoverThumb
            queueTracks={trackRows}
          />
        )}
      />
    </div>
  );
}
