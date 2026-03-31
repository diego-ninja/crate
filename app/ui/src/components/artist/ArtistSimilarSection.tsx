import { ArtistNetworkGraph } from "@/components/artist/ArtistNetworkGraph";
import { SimilarArtistCard } from "@/components/artist/ArtistPageBits";

interface SimilarArtist {
  name: string;
  image?: string;
  genres?: string[];
  popularity?: number;
}

interface ArtistSimilarSectionProps {
  artistName: string;
  artists: SimilarArtist[];
}

export function ArtistSimilarSection({ artistName, artists }: ArtistSimilarSectionProps) {
  return (
    <div>
      <div className="bg-card border border-border rounded-lg p-4 mb-6">
        <h4 className="text-sm font-semibold mb-3">Artist Network</h4>
        <ArtistNetworkGraph centerArtist={artistName} />
      </div>
      {artists.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
          {artists.map((artist) => (
            <SimilarArtistCard
              key={artist.name}
              name={artist.name}
              genres={artist.genres}
              popularity={artist.popularity}
            />
          ))}
        </div>
      )}
    </div>
  );
}
