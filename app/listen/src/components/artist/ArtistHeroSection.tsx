import { ArtistHeroActions } from "@/components/artist/ArtistHeroActions";
import { ArtistHeroArtwork } from "@/components/artist/ArtistHeroArtwork";
import {
  type ArtistData,
  type ArtistInfo,
} from "@/components/artist/artist-model";

interface ArtistHeroSectionProps {
  artist: ArtistData;
  artistInfo?: ArtistInfo;
  photoUrl: string;
  backgroundUrl?: string;
  tags: string[];
  following: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  onArtistRadio: () => void;
  onPlaySetlist?: () => void;
  hasSetlist?: boolean;
  onToggleFollow: () => void;
  onShare: () => void;
  onOpenBio: () => void;
}

export function ArtistHeroSection({
  artist,
  artistInfo,
  photoUrl,
  backgroundUrl,
  following,
  onPlay,
  onShuffle,
  onArtistRadio,
  onPlaySetlist,
  hasSetlist,
  onToggleFollow,
  onShare,
  onOpenBio,
}: ArtistHeroSectionProps) {
  return (
    <>
      <ArtistHeroArtwork
        artist={artist}
        artistInfo={artistInfo}
        photoUrl={photoUrl}
        backgroundUrl={backgroundUrl}
        onOpenBio={onOpenBio}
      />
      <ArtistHeroActions
        artist={artist}
        photoUrl={photoUrl}
        following={following}
        hasSetlist={hasSetlist}
        onPlay={onPlay}
        onShuffle={onShuffle}
        onArtistRadio={onArtistRadio}
        onPlaySetlist={onPlaySetlist}
        onToggleFollow={onToggleFollow}
        onShare={onShare}
      />
    </>
  );
}
