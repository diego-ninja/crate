import type { TrackRowData } from "@/components/cards/TrackRow";
import type { PlayableTrackInput } from "@/lib/playable-track";
import { toPlayableTrack } from "@/lib/playable-track";

type TrackRowDataInput = PlayableTrackInput & {
  track_number?: number | null;
};

export function toTrackRowData(input: TrackRowDataInput): TrackRowData {
  const track = toPlayableTrack(input);
  return {
    id: track.id,
    entity_uid: track.entityUid,
    title: track.title,
    artist: track.artist,
    artist_id: track.artistId,
    artist_entity_uid: track.artistEntityUid,
    artist_slug: track.artistSlug,
    album: track.album,
    album_id: track.albumId,
    album_entity_uid: track.albumEntityUid,
    album_slug: track.albumSlug,
    duration: input.duration ?? undefined,
    path: track.path,
    track_number: input.track_number ?? undefined,
    format: track.format,
    bitrate: track.bitrate,
    sample_rate: track.sampleRate,
    bit_depth: track.bitDepth,
    library_track_id: track.libraryTrackId,
  };
}
