import { ArtistNetworkGraph } from "@/components/artist/ArtistNetworkGraph";
import { ArtistStats } from "@/components/artist/ArtistStats";

interface ArtistStatsSectionProps {
  artistName: string;
  artistId?: number;
}

export function ArtistStatsSection({ artistName, artistId }: ArtistStatsSectionProps) {
  return (
    <div className="space-y-6">
      <ArtistStats artistId={artistId} />
      <div className="bg-card border border-border rounded-lg p-4">
        <h4 className="text-sm font-semibold mb-3">Artist Network</h4>
        <ArtistNetworkGraph centerArtist={artistName} centerArtistId={artistId} />
      </div>
    </div>
  );
}
