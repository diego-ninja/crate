import { ArtistNetworkGraph } from "@/components/artist/ArtistNetworkGraph";
import { ArtistStats } from "@/components/artist/ArtistStats";

interface ArtistStatsSectionProps {
  artistName: string;
}

export function ArtistStatsSection({ artistName }: ArtistStatsSectionProps) {
  return (
    <div className="space-y-6">
      <ArtistStats name={artistName} />
      <div className="bg-card border border-border rounded-lg p-4">
        <h4 className="text-sm font-semibold mb-3">Artist Network</h4>
        <ArtistNetworkGraph centerArtist={artistName} />
      </div>
    </div>
  );
}
