import { Disc3 } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";

interface SpinningDiscArtworkProps {
  albumCover?: string | null;
  crossfadeIncomingCover?: string | null;
  crossfadeOutgoingCover?: string | null;
  crossfadeProgress: number;
}

export function SpinningDiscArtwork({
  albumCover,
  crossfadeIncomingCover,
  crossfadeOutgoingCover,
  crossfadeProgress,
}: SpinningDiscArtworkProps) {
  const showCrossfade = !!crossfadeOutgoingCover && !!crossfadeIncomingCover;

  if (showCrossfade) {
    return (
      <>
        <CrateImage
          src={crossfadeOutgoingCover}
          alt=""
          className="absolute inset-0 size-full object-cover"
          style={{ opacity: 1 - crossfadeProgress }}
        />
        <CrateImage
          src={crossfadeIncomingCover}
          alt=""
          className="absolute inset-0 size-full object-cover"
          style={{ opacity: crossfadeProgress }}
        />
      </>
    );
  }

  if (albumCover) {
    return (
      <CrateImage
        src={albumCover}
        alt=""
        className="absolute inset-0 size-full object-cover"
      />
    );
  }

  return (
    <div className="spinning-disc-placeholder absolute inset-0 flex items-center justify-center">
      <Disc3 size={88} className="spinning-disc-placeholder-icon" />
    </div>
  );
}
