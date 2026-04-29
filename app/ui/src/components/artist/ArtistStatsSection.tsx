import { ArtistNetworkGraph } from "@/components/artist/ArtistNetworkGraph";
import { ArtistStats } from "@/components/artist/ArtistStats";

interface ArtistStatsSectionProps {
  artistName: string;
  artistId?: number;
  artistEntityUid?: string;
}

export function ArtistStatsSection({ artistName, artistId, artistEntityUid }: ArtistStatsSectionProps) {
  return (
    <div className="space-y-6">
      <ArtistStats artistId={artistId} artistEntityUid={artistEntityUid} />
      <div className="bg-card border border-border rounded-md p-4">
        <h4 className="text-sm font-semibold mb-3">Artist Network</h4>
        <ArtistNetworkGraph centerArtist={artistName} centerArtistId={artistId} centerArtistEntityUid={artistEntityUid} />
      </div>
    </div>
  );
}
