import { useState, useEffect } from "react";
import { useParams } from "react-router";
import { useApi } from "@/hooks/use-api";
import { AlbumHeader } from "@/components/album/AlbumHeader";
import { TrackTable } from "@/components/album/TrackTable";
import { AudioProfileCard } from "@/components/album/AudioProfileCard";
import { TagEditor } from "@/components/album/TagEditor";
import { RelatedAlbums } from "@/components/album/RelatedAlbums";
import { MatchCard } from "@/components/scanner/MatchCard";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";

export interface AudioMuseTrack {
  tempo: number | null;
  key: string | null;
  scale: string | null;
  energy: number | null;
  mood: Record<string, number> | null;
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  loudness: number | null;
  dynamic_range: number | null;
  spectral_complexity: number | null;
}

interface AlbumData {
  artist: string;
  name: string;
  display_name?: string;
  path: string;
  track_count: number;
  total_size_mb: number;
  total_length_sec: number;
  has_cover: boolean;
  cover_file: string | null;
  tracks: {
    id?: number;
    filename: string;
    format: string;
    size_mb: number;
    bitrate: number | null;
    length_sec: number;
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
}

interface NavidromeAlbumLink {
  id: string;
  name: string;
  songs: { id: string; title: string; track: number; duration: number }[];
  navidrome_url: string;
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
  const { artist, album } = useParams<{ artist: string; album: string }>();
  const { data, loading, refetch } = useApi<AlbumData>(
    artist && album
      ? `/api/album/${encPath(artist)}/${encPath(album)}`
      : null,
  );
  const [showTags, setShowTags] = useState(false);
  const [matches, setMatches] = useState<MatchResult[] | null>(null);
  const [matching, setMatching] = useState(false);
  const [pendingMatch, setPendingMatch] = useState<MatchResult | null>(null);
  const [navidromeData, setNavidromeData] = useState<NavidromeAlbumLink | null>(null);
  const [audiomuseData, setAudiomuseData] = useState<Record<string, AudioMuseTrack> | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!artist || !album) return;
    let cancelled = false;
    api<NavidromeAlbumLink>(`/api/navidrome/album/${encPath(artist)}/${encPath(album)}/link`)
      .then((d) => { if (!cancelled) setNavidromeData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [artist, album]);

  function fetchAudiomuseData(artistName: string) {
    api<Record<string, AudioMuseTrack>>(`/api/analyze/artist/${encPath(artistName)}/data`)
      .then((d) => {
        if (d && Object.keys(d).length > 0) setAudiomuseData(d);
        else return api<Record<string, AudioMuseTrack>>(`/api/audiomuse/artist/${encPath(artistName)}/tracks`);
      })
      .then((d) => {
        if (d && Object.keys(d).length > 0) setAudiomuseData(d);
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (!data?.artist) return;
    fetchAudiomuseData(data.artist);
  }, [data?.artist]);

  async function findMatches() {
    if (!artist || !album) return;
    setMatching(true);
    try {
      const results = await api<MatchResult[]>(
        `/api/match/${encPath(artist)}/${encPath(album)}`,
      );
      setMatches(results);
    } finally {
      setMatching(false);
    }
  }

  async function applyMatch(match: MatchResult) {
    if (!artist || !album) return;
    try {
      const { task_id } = await api<{ task_id: string }>("/api/match/apply", "POST", {
        artist_folder: artist,
        album_folder: album,
        release: match,
      });
      setPendingMatch(null);
      toast.success("Applying tags...");
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string; result?: { updated?: number; errors?: unknown[] } }>(`/api/tasks/${task_id}`);
          if (task.status === "completed") {
            clearInterval(poll);
            toast.success(`Tags applied (${task.result?.updated ?? 0} tracks updated)`);
            refetch();
          } else if (task.status === "failed") {
            clearInterval(poll);
            toast.error("Failed to apply tags");
          }
        } catch { /* keep polling */ }
      }, 2000);
      setTimeout(() => clearInterval(poll), 60000);
    } catch {
      toast.error("Failed to start tag apply");
    }
  }

  if (loading) {
    return (
      <div className="-mx-8 -mt-8">
        <div className="h-[300px] bg-card animate-pulse" />
        <div className="px-8 pt-6">
          <Skeleton className="h-6 w-48 mb-4" />
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return <div className="text-center py-12 text-muted-foreground">Not found</div>;

  return (
    <div className="-mx-8 -mt-8">
      <div className="px-8 pt-8">
        <AlbumHeader
          artist={data.artist}
          album={data.display_name || data.name}
          albumTags={data.album_tags}
          trackCount={data.track_count}
          totalLengthSec={data.total_length_sec}
          totalSizeMb={data.total_size_mb}
          hasCover={data.has_cover}
          navidromeData={navidromeData}
          tracks={data.tracks}
          genres={data.genres}
          hasAnalysis={audiomuseData != null && Object.values(audiomuseData).some((t) => t.tempo != null)}
          onAnalysisComplete={() => data?.artist && fetchAudiomuseData(data.artist)}
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
      </div>

      <div className="px-8 pb-12">
        {showTags && (
          <TagEditor
            artist={data.artist}
            album={data.name}
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

        {data.genres && data.genres.length > 0 && (
          <div className="mb-4 flex gap-1.5 flex-wrap">
            {data.genres.map(g => (
              <Badge key={g} variant="secondary" className="text-xs cursor-pointer hover:bg-primary/20"
                onClick={() => navigate(`/browse?genre=${encodeURIComponent(g.toLowerCase())}`)}>
                {g.toLowerCase()}
              </Badge>
            ))}
          </div>
        )}

        {audiomuseData && data && (() => {
          // Filter audiomuse data to only tracks in this album
          const albumTitles = new Set(data.tracks.map((t: { tags: { title?: string }; filename: string }) => (t.tags.title || t.filename).toLowerCase()));
          const filtered = Object.fromEntries(Object.entries(audiomuseData).filter(([k]) => albumTitles.has(k)));
          return Object.keys(filtered).length > 0 ? <AudioProfileCard audiomuseData={filtered} /> : null;
        })()}

        <div>
          <h3 className="font-semibold mb-3">Tracks</h3>
          <TrackTable
            tracks={data.tracks}
            navidromeSongs={navidromeData?.songs}
            artist={data.artist}
            albumCover={`/api/cover/${encPath(data.artist)}/${encPath(data.name)}`}
            audiomuseData={audiomuseData ?? undefined}
          />
        </div>

        <RelatedAlbums artist={data.artist} album={data.name} />

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
              await api(`/api/manage/album/${encPath(data.artist)}/${encPath(data.name)}/delete`, "POST", { mode: "full" });
              toast.success("Album deleted");
              navigate(`/artist/${encPath(data.artist)}`);
            } catch {
              toast.error("Failed to delete album");
            }
          }}
        />
      </div>
    </div>
  );
}
