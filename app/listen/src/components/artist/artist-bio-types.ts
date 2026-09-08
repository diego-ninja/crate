import type { ArtistData, ArtistInfo } from "./artist-model";

export interface MBMember {
  name: string;
  attributes?: string[];
  begin?: string;
  end?: string;
}

export interface EnrichmentData {
  lastfm?: {
    bio?: string;
    tags?: string[];
    similar?: { name: string; match: number }[];
    listeners?: number;
  };
  spotify?: { followers?: number; popularity?: number };
  musicbrainz?: {
    country?: string;
    area?: string;
    begin_date?: string;
    type?: string;
    members?: MBMember[];
    urls?: Record<string, string>;
  };
}

export interface ArtistBioModalProps {
  open: boolean;
  artist: ArtistData;
  artistInfo?: ArtistInfo;
  photoUrl: string;
  tags: string[];
  onClose: () => void;
}
