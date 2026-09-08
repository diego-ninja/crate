import { TrackRow } from "@/components/cards/TrackRow";
import type { PlaylistTrack } from "@/pages/playlist-types";
import { toTrackRowData } from "@/lib/track-row-data";
import { WindowVirtualList } from "@/components/ui/WindowVirtualList";
import type { TrackRowData } from "@/components/cards/TrackRow";

export function PlaylistTrackList({
  filteredTracks,
  onActionMenuOpen,
  onAddToPlaylist,
  onCreatePlaylist,
  onPlayTrack,
  playlistOptions,
}: {
  filteredTracks: PlaylistTrack[];
  onActionMenuOpen: () => void;
  onAddToPlaylist: (
    playlistId: number,
    track: TrackRowData,
  ) => void | Promise<void>;
  onCreatePlaylist: (track: TrackRowData) => void | Promise<void>;
  onPlayTrack: (trackEntryId: number) => void;
  playlistOptions: { id: number; name: string }[];
}) {
  return (
    <WindowVirtualList
      items={filteredTracks}
      itemKey={(track) => track.id ?? `${track.track_path}-${track.position}`}
      renderItem={(track, index) => (
        <TrackRow
          track={toTrackRowData({
            ...track,
            id: track.track_id ?? track.track_path ?? track.title,
            global_track_uid: track.global_track_uid,
            global_artist_uid: track.global_artist_uid,
            global_album_uid: track.global_album_uid,
            library_track_id: track.track_id,
          })}
          index={index + 1}
          showCoverThumb
          showArtist
          showAlbum
          playlistOptions={playlistOptions}
          onAddToPlaylist={onAddToPlaylist}
          onCreatePlaylist={onCreatePlaylist}
          onActionMenuOpen={onActionMenuOpen}
          onPlayOverride={() => onPlayTrack(track.id)}
        />
      )}
    />
  );
}
