import { useState, useEffect } from "react";
import { useParams } from "react-router";
import { useApi } from "@/hooks/use-api";
import { AlbumHeader } from "@/components/album/AlbumHeader";
import { TrackTable } from "@/components/album/TrackTable";
import { TagEditor } from "@/components/album/TagEditor";
import { MatchCard } from "@/components/scanner/MatchCard";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export interface AudioMuseTrack {
  tempo: number | null;
  key: string | null;
  scale: string | null;
  energy: number | null;
}

interface AlbumData {
  artist: string;
  name: string;
  path: string;
  track_count: number;
  total_size_mb: number;
  total_length_sec: number;
  has_cover: boolean;
  cover_file: string | null;
  tracks: {
    filename: string;
    format: string;
    size_mb: number;
    bitrate: number | null;
    length_sec: number;
    tags: Record<string, string>;
  }[];
  album_tags: {
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    musicbrainz_albumid?: string | null;
  };
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

  useEffect(() => {
    if (!artist || !album) return;
    let cancelled = false;
    api<NavidromeAlbumLink>(`/api/navidrome/album/${encPath(artist)}/${encPath(album)}/link`)
      .then((d) => { if (!cancelled) setNavidromeData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [artist, album]);

  useEffect(() => {
    if (!data?.artist) return;
    api<Record<string, AudioMuseTrack>>(`/api/audiomuse/artist/${encPath(data.artist)}/tracks`)
      .then((d) => {
        if (d && Object.keys(d).length > 0) setAudiomuseData(d);
      })
      .catch(() => {});
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
    await api("/api/match/apply", "POST", {
      artist_folder: artist,
      album_folder: album,
      release: match,
    });
    setPendingMatch(null);
    refetch();
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
          album={data.name}
          albumTags={data.album_tags}
          trackCount={data.track_count}
          totalLengthSec={data.total_length_sec}
          totalSizeMb={data.total_size_mb}
          hasCover={data.has_cover}
          navidromeData={navidromeData}
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
        </AlbumHeader>
      </div>

      <div className="px-8 pb-12">
        {showTags && (
          <TagEditor
            artist={data.artist}
            album={data.name}
            tags={data.album_tags}
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

        <ConfirmDialog
          open={pendingMatch !== null}
          onOpenChange={(open) => !open && setPendingMatch(null)}
          title="Apply MusicBrainz Tags"
          description="This will overwrite current tags with MusicBrainz data. Are you sure?"
          confirmLabel="Apply Tags"
          variant="destructive"
          onConfirm={() => pendingMatch && applyMatch(pendingMatch)}
        />
      </div>
    </div>
  );
}
