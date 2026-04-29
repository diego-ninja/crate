import { AlbumCard } from "@/components/album/AlbumCard";
import { MissingAlbumCard } from "@/components/album/MissingAlbumCard";
import { TidalAlbumCard } from "@/components/album/TidalAlbumCard";
import type { ArtistAlbumSummary } from "@/components/artist/artistPageTypes";
import { Button } from "@crate/ui/shadcn/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { Disc3, Eye, EyeOff, Loader2 } from "lucide-react";

interface MissingAlbum {
  title: string;
  first_release_date: string;
  type: string;
}

interface TidalMissingAlbum {
  url: string;
  title: string;
  year: string;
  tracks: number;
  cover: string | null;
  quality: string;
}

interface ArtistDiscographySectionProps {
  artistName: string;
  artistId?: number;
  artistEntityUid?: string;
  artistSlug?: string;
  albums: ArtistAlbumSummary[];
  sortedAlbums: ArtistAlbumSummary[];
  missingAlbums: MissingAlbum[];
  tidalMissing: TidalMissingAlbum[];
  showMissing: boolean;
  sort: string;
  downloadingDiscog: boolean;
  onToggleShowMissing: () => void;
  onSortChange: (value: string) => void;
  onDownloadDiscography: () => Promise<void> | void;
}

export function ArtistDiscographySection({
  artistName,
  artistId,
  artistEntityUid,
  artistSlug,
  albums,
  sortedAlbums,
  missingAlbums,
  tidalMissing,
  showMissing,
  sort,
  downloadingDiscog,
  onToggleShowMissing,
  onSortChange,
  onDownloadDiscography,
}: ArtistDiscographySectionProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">{albums.length} Albums</h2>
          {missingAlbums.length > 0 && (
            <button
              onClick={onToggleShowMissing}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showMissing ? <Eye size={14} /> : <EyeOff size={14} />}
              {showMissing ? "Hide" : "Show"} missing ({missingAlbums.length})
            </button>
          )}
          {tidalMissing.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-primary/30 text-primary hover:bg-primary/10"
              disabled={downloadingDiscog}
              onClick={() => {
                void onDownloadDiscography();
              }}
            >
              {downloadingDiscog ? (
                <Loader2 size={14} className="animate-spin mr-1" />
              ) : (
                <Disc3 size={14} className="mr-1" />
              )}
              Complete Discography ({tidalMissing.length} from Tidal)
            </Button>
          )}
        </div>
        <Select value={sort} onValueChange={onSortChange}>
          <SelectTrigger className="w-[140px] bg-card border-border h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="year">Newest</SelectItem>
            <SelectItem value="tracks">Most Tracks</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        {(() => {
          type GridItem =
            | { kind: "local"; album: ArtistAlbumSummary }
            | { kind: "tidal"; album: TidalMissingAlbum }
            | { kind: "missing"; album: MissingAlbum };

          const items: GridItem[] = sortedAlbums.map((album) => ({ kind: "local", album }));
          const tidalTitles = new Set(tidalMissing.map((album) => album.title.toLowerCase()));

          for (const album of tidalMissing) {
            items.push({ kind: "tidal", album });
          }

          if (showMissing) {
            for (const album of missingAlbums) {
              if (!tidalTitles.has(album.title.toLowerCase())) {
                items.push({ kind: "missing", album });
              }
            }
          }

          if (sort === "year") {
            items.sort((a, b) => {
              const yearA =
                a.kind === "local" ? a.album.year || "" : a.kind === "tidal" ? a.album.year || "" : a.album.first_release_date || "";
              const yearB =
                b.kind === "local" ? b.album.year || "" : b.kind === "tidal" ? b.album.year || "" : b.album.first_release_date || "";
              return yearB.localeCompare(yearA);
            });
          }

          return items.map((item) =>
            item.kind === "local" ? (
              <AlbumCard
                key={`local-${item.album.name}`}
                albumId={item.album.id}
                albumEntityUid={item.album.entity_uid}
                albumSlug={item.album.slug}
                artist={artistName}
                artistId={artistId}
                artistEntityUid={artistEntityUid}
                artistSlug={artistSlug}
                name={item.album.name}
                displayName={item.album.display_name}
                year={item.album.year}
                tracks={item.album.tracks}
                formats={item.album.formats}
                bitDepth={item.album.bit_depth}
                sampleRate={item.album.sample_rate}
                hasCover={item.album.has_cover}
              />
            ) : item.kind === "tidal" ? (
              artistId != null ? (
                <TidalAlbumCard
                  key={`tidal-${item.album.url}`}
                  artist={artistName}
                  artistId={artistId}
                  artistEntityUid={artistEntityUid}
                  title={item.album.title}
                  year={item.album.year}
                  tracks={item.album.tracks}
                  cover={item.album.cover}
                  url={item.album.url}
                />
              ) : null
            ) : (
              <MissingAlbumCard
                key={`missing-${item.album.title}`}
                title={item.album.title}
                year={item.album.first_release_date}
                type={item.album.type}
              />
            ),
          );
        })()}
      </div>
    </div>
  );
}
