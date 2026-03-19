import { AlbumCard } from "./AlbumCard";

interface AlbumData {
  name: string;
  year?: string;
  tracks: number;
  formats: string[];
  has_cover?: boolean;
  size_mb?: number;
}

interface AlbumGridProps {
  artist: string;
  albums: AlbumData[];
}

export function AlbumGrid({ artist, albums }: AlbumGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
      {albums.map((a) => (
        <AlbumCard
          key={a.name}
          artist={artist}
          name={a.name}
          year={a.year}
          tracks={a.tracks}
          formats={a.formats}
          hasCover={a.has_cover}
        />
      ))}
    </div>
  );
}
