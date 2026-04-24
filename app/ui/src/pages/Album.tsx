import { useState, useEffect } from "react";
import { useParams } from "react-router";
import { useApi } from "@/hooks/use-api";
import { AlbumHeader } from "@/components/album/AlbumHeader";
import { AudioProfileCard } from "@/components/album/AudioProfileCard";
import { TrackTable, type AudioAnalysisTrack } from "@/components/album/TrackTable";
import { TagEditor } from "@/components/album/TagEditor";
import { RelatedAlbums } from "@/components/album/RelatedAlbums";
import { GenrePillRow, type GenreProfileItem } from "@/components/genres/GenrePill";
import { MatchCard } from "@/components/scanner/MatchCard";
import { Button } from "@crate/ui/shadcn/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@crate/ui/shadcn/skeleton";
import { api } from "@/lib/api";
import { albumApiPath, albumCoverApiUrl, artistPagePath } from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";
import { Badge } from "@crate/ui/shadcn/badge";
import { AudioWaveform, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";

interface AlbumData {
  id?: number;
  slug?: string;
  artist_id?: number;
  artist_slug?: string;
  artist: string;
  name: string;
  display_name?: string;
  path: string;
  track_count: number;
  total_size_mb: number;
  total_length_sec: number;
  has_cover: boolean;
  cover_file: string | null;
  popularity?: number | null;
  popularity_score?: number | null;
  popularity_confidence?: number | null;
  tracks: {
    id?: number;
    filename: string;
    format: string;
    size_mb: number;
    bitrate: number | null;
    length_sec: number;
    popularity?: number | null;
    popularity_score?: number | null;
    popularity_confidence?: number | null;
    rating?: number;
    tags: Record<string, string>;
  }[];
  album_tags: {
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    musicbrainz_albumid?: string | null;
  };
  genres?: string[];
  genre_profile?: GenreProfileItem[];
}

interface MatchResult {
  title: string;
  artist: string;
  date?: string;
  country?: string;
  track_count: number;
  match_score: number;
  tag_preview?: {
    current_title: string;
    new_title: string;
    new_track: string;
    duration_diff: number | null;
  }[];
  [key: string]: unknown;
}

export function Album() {
  const { albumId: albumIdParam } = useParams<{ albumId?: string }>();
  const albumId = albumIdParam ? Number(albumIdParam) : undefined;
  const { data, loading, refetch } = useApi<AlbumData>(albumId != null ? albumApiPath({ albumId }) : null);
  const [showTags, setShowTags] = useState(false);
  const [matches, setMatches] = useState<MatchResult[] | null>(null);
  const [matching, setMatching] = useState(false);
  const [pendingMatch, setPendingMatch] = useState<MatchResult | null>(null);
  const [analysisData, setAnalysisData] = useState<Record<string, AudioAnalysisTrack> | null>(null);

  useEffect(() => {
    if (data?.artist_id == null) return;
    api<Record<string, AudioAnalysisTrack>>(`/api/artists/${data.artist_id}/analysis-data`)
      .then((d) => { if (d && Object.keys(d).length > 0) setAnalysisData(d); })
      .catch(() => {});
  }, [data?.artist_id]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  async function findMatches() {
    if (data?.id == null) return;
    setMatching(true);
    try {
      const results = await api<MatchResult[]>(
        `/api/match/albums/${data.id}`,
      );
      setMatches(results);
    } finally {
      setMatching(false);
    }
  }

  async function applyMatch(match: MatchResult) {
    if (data?.id == null) return;
    try {
      const { task_id } = await api<{ task_id: string }>("/api/match/apply", "POST", {
        album_id: data.id,
        release: match,
      });
      setPendingMatch(null);
      toast.success("Applying tags...");
      const task = await waitForTask(task_id, 60000);
      if (task.status === "completed") {
        toast.success(`Tags applied (${Number(task.result?.updated ?? 0)} tracks updated)`);
        refetch();
      } else if (task.status === "failed") {
        toast.error("Failed to apply tags");
      }
    } catch {
      toast.error("Failed to start tag apply");
    }
  }

  if (loading) {
    return (
      <div className="-mt-16 md:-mt-[6.5rem]">
        <div className="-mx-4 h-[420px] animate-pulse bg-card md:-mx-8 md:h-[560px]" />
        <div className="mx-auto w-full max-w-[1160px] px-4 pt-6 md:px-8">
          <Skeleton className="mb-4 h-6 w-48" />
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return <div className="text-center py-12 text-muted-foreground">Not found</div>;

  return (
    <div className="-mt-16 md:-mt-[6.5rem]">
        <AlbumHeader
          albumId={data.id}
          albumSlug={data.slug}
          artistId={data.artist_id}
          artistSlug={data.artist_slug}
          artist={data.artist}
          album={data.name}
          displayName={data.display_name}
          albumTags={data.album_tags}
          trackCount={data.track_count}
          totalLengthSec={data.total_length_sec}
          totalSizeMb={data.total_size_mb}
          hasCover={data.has_cover}
          popularity={data.popularity}
          popularityScore={data.popularity_score}
          popularityConfidence={data.popularity_confidence}
          genres={data.genres}
          genreProfile={data.genre_profile}
          hasAnalysis={analysisData != null && Object.values(analysisData).some((t) => t.tempo != null)}
          isAdmin={isAdmin}
          onAnalysisComplete={() => {
            if (data?.artist_id == null) return;
            api<Record<string, AudioAnalysisTrack>>(`/api/artists/${data.artist_id}/analysis-data`)
              .then((d) => { if (d && Object.keys(d).length > 0) setAnalysisData(d); })
              .catch(() => {});
          }}
        >
          <Button
            size="sm"
            variant="outline"
            className="border-white/20 text-white/70 hover:text-white hover:bg-white/10"
            onClick={() => setShowTags(!showTags)}
          >
            Edit Tags
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-green-500/30 text-green-500 hover:bg-green-500/10"
            onClick={findMatches}
            disabled={matching}
          >
            {matching ? (
              <>
                <Loader2 size={14} className="animate-spin mr-1" />
                Searching...
              </>
            ) : (
              "Sync MusicBrainz"
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-white/20 text-white/70 hover:text-white hover:bg-white/10"
            onClick={async () => {
              try {
                await api(`/api/albums/${data.id}/analyze`, "POST");
                toast.success("Analysis queued", { description: "Background daemons will process the tracks." });
              } catch {
                toast.error("Failed to queue analysis");
              }
            }}
          >
            <AudioWaveform size={14} className="mr-1" /> Analyze
          </Button>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="border-red-500/30 text-red-400 hover:text-red-300 hover:bg-red-500/10"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 size={14} className="mr-1" /> Delete
            </Button>
          )}
        </AlbumHeader>

      <div className="mx-auto w-full max-w-[1160px] px-4 pb-12 pt-6 md:px-8">
        {showTags && data.id != null && (
          <TagEditor
            albumId={data.id}
            tags={data.album_tags}
            tracks={data.tracks?.map((t: { filename: string; tags: { title?: string; tracknumber?: string; artist?: string } }) => ({
              filename: t.filename,
              title: t.tags.title,
              tracknumber: t.tags.tracknumber,
              artist: t.tags.artist,
            }))}
            onSaved={refetch}
          />
        )}

        {matches !== null && (
          <div className="mb-8">
            <h3 className="font-semibold mb-3">MusicBrainz Matches</h3>
            {matches.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No matches found on MusicBrainz
              </div>
            ) : (
              matches.map((m, i) => (
                <MatchCard
                  key={i}
                  match={m}
                  onApply={() => setPendingMatch(m)}
                />
              ))
            )}
          </div>
        )}

        {data.album_tags.musicbrainz_albumid && (
          <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">
              MBID {data.album_tags.musicbrainz_albumid.slice(0, 8)}
            </Badge>
            <a
              href={`https://musicbrainz.org/release/${data.album_tags.musicbrainz_albumid}`}
              target="_blank" rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              View on MusicBrainz ↗
            </a>
          </div>
        )}

        {data.genre_profile && data.genre_profile.length > 0 ? (
          <div className="mb-4">
            <GenrePillRow
              items={data.genre_profile}
              max={8}
              onSelect={(genre) => navigate(`/browse?genre=${encodeURIComponent(genre.name.toLowerCase())}`)}
            />
          </div>
        ) : data.genres && data.genres.length > 0 && (
          <div className="mb-4 flex gap-1.5 flex-wrap">
            {data.genres.map(g => (
              <Badge key={g} variant="secondary" className="text-xs cursor-pointer hover:bg-primary/20"
                onClick={() => navigate(`/browse?genre=${encodeURIComponent(g.toLowerCase())}`)}>
                {g.toLowerCase()}
              </Badge>
            ))}
          </div>
        )}

        {analysisData && data && (() => {
          const albumTitles = new Set(data.tracks.map((t: { tags: { title?: string }; filename: string }) => (t.tags.title || t.filename).toLowerCase()));
          const filtered = Object.fromEntries(Object.entries(analysisData).filter(([k]) => albumTitles.has(k)));
          return Object.keys(filtered).length > 0 ? <AudioProfileCard analysisData={filtered} /> : null;
        })()}

        <div>
          <h3 className="font-semibold mb-3">Tracks</h3>
          <TrackTable
            tracks={data.tracks}
            artist={data.artist}
            artistId={data.artist_id}
            artistSlug={data.artist_slug}
            album={data.name}
            albumId={data.id}
            albumSlug={data.slug}
            albumCover={albumCoverApiUrl({ albumId: data.id, albumSlug: data.slug, artistName: data.artist, albumName: data.name })}
            analysisData={analysisData ?? undefined}
          />
        </div>

        <RelatedAlbums albumId={data.id} />

        <ConfirmDialog
          open={pendingMatch !== null}
          onOpenChange={(open) => !open && setPendingMatch(null)}
          title="Apply MusicBrainz Tags"
          description="This will overwrite current tags with MusicBrainz data. Are you sure?"
          confirmLabel="Apply Tags"
          variant="destructive"
          onConfirm={() => pendingMatch && applyMatch(pendingMatch)}
        />

        <ConfirmDialog
          open={showDeleteConfirm}
          onOpenChange={setShowDeleteConfirm}
          title="Delete Album"
          description={`This will permanently delete "${data.display_name || data.name}" by ${data.artist} from the database AND the filesystem. This action cannot be undone.`}
          confirmLabel="Delete Album"
          variant="destructive"
          onConfirm={async () => {
            try {
              await api<{ task_id: string }>(`/api/manage/albums/${data.id}/delete`, "POST", { mode: "full" });
              toast.success("Album deletion queued", {
                description: "The worker will delete the album in the background.",
              });
              navigate(artistPagePath({ artistId: data.artist_id, artistSlug: data.artist_slug, artistName: data.artist }));
            } catch (error) {
              const message =
                error instanceof Error && error.message
                  ? error.message
                  : "Failed to queue album deletion";
              toast.error(message);
            }
          }}
        />
      </div>
    </div>
  );
}
