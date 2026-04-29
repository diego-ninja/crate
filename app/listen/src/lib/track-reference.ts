import {
  getPlayableTrackLibraryId,
  hasPlayableTrackReference,
  type PlayableTrackInput,
  type PlayableTrackIdentityInput,
} from "@/lib/playable-track";

export interface TrackReferencePayload {
  track_id?: number;
  entity_uid?: string;
  path?: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
}

type TrackReferenceInput = PlayableTrackIdentityInput & Partial<Pick<
  PlayableTrackInput,
  "title" | "artist" | "album" | "duration"
>>;

export function hasTrackReference(input: PlayableTrackIdentityInput): boolean {
  return hasPlayableTrackReference(input);
}

export function toTrackReferencePayload(input: TrackReferenceInput): TrackReferencePayload {
  return {
    track_id: getPlayableTrackLibraryId(input),
    entity_uid: input.entityUid ?? input.entity_uid ?? undefined,
    path: input.path ?? undefined,
    title: input.title ?? undefined,
    artist: input.artist,
    album: input.album ?? undefined,
    duration: input.duration ?? undefined,
  };
}
