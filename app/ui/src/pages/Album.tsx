import { useState, useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router";
import { useApi } from "@/hooks/use-api";
import { AlbumHeader } from "@/components/album/AlbumHeader";
import { AudioProfileCard } from "@/components/album/AudioProfileCard";
import { TrackTable, type AudioAnalysisTrack, type TrackLyricsStatus } from "@/components/album/TrackTable";
import { TagEditor } from "@/components/album/TagEditor";
import { RelatedAlbums } from "@/components/album/RelatedAlbums";
import { GenrePillRow, type GenreProfileItem } from "@/components/genres/GenrePill";
import { MatchCard } from "@/components/scanner/MatchCard";
import { Button } from "@crate/ui/shadcn/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@crate/ui/shadcn/skeleton";
import { api } from "@/lib/api";
import { albumApiPath, albumCoverApiUrl, albumManagementApiPath, albumMatchApiPath, albumPagePath, albumReanalyzeApiPath, artistActionApiPath, artistPagePath } from "@/lib/library-routes";
import { useTaskEvents } from "@/hooks/use-task-events";
import { waitForTask } from "@/lib/tasks";
import { Badge } from "@crate/ui/shadcn/badge";
import { AudioWaveform, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";

interface AlbumData {
  id?: number;
  entity_uid?: string;
  slug?: string;
  artist_id?: number;
  artist_entity_uid?: string;
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
    entity_uid?: string;
    filename: string;
    format: string;
    size_mb: number;
    bitrate: number | null;
    sample_rate?: number | null;
    bit_depth?: number | null;
    length_sec: number;
    popularity?: number | null;
    popularity_score?: number | null;
    popularity_confidence?: number | null;
    rating?: number;
    lyrics?: TrackLyricsStatus;
    stream_variants?: AlbumTrackStreamVariant[];
    tags: Record<string, string>;
    path?: string;
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

type AlbumMetadataAction = "lyrics" | "portable" | "export";

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

interface AlbumTrackStreamVariant {
  id: string;
  preset: string;
  status: string;
  delivery_format: string;
  delivery_codec: string;
  delivery_bitrate: number;
  delivery_sample_rate?: number | null;
  bytes?: number | null;
  error?: string | null;
  task_id?: string | null;
  task_status?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
}

function lyricOverrideKeyFromEvent(data: Record<string, unknown>) {
  if (data.track_id != null) return `id:${data.track_id}`;
  if (data.track_entity_uid) return `uid:${data.track_entity_uid}`;
  if (data.path) return `path:${data.path}`;
  return "";
}

function lyricOverrideKeysForTrack(track: AlbumData["tracks"][number]) {
  return [
    track.id != null ? `id:${track.id}` : "",
    track.entity_uid ? `uid:${track.entity_uid}` : "",
    track.path ? `path:${track.path}` : "",
  ].filter(Boolean);
}

function primaryLyricOverrideKeyForTrack(track: AlbumData["tracks"][number]) {
  return lyricOverrideKeysForTrack(track)[0] || `file:${track.filename}`;
}

function lyricsStatusFromTaskEvent(data: Record<string, unknown>): TrackLyricsStatus {
  const lyrics = data.lyrics && typeof data.lyrics === "object" ? data.lyrics as Record<string, unknown> : data;
  return {
    status: String(lyrics.status || data.status || "none"),
    found: Boolean(lyrics.found ?? data.found),
    has_plain: Boolean(lyrics.has_plain ?? data.has_plain),
    has_synced: Boolean(lyrics.has_synced ?? data.has_synced),
    provider: String(lyrics.provider || data.provider || "lrclib"),
    updated_at: typeof lyrics.updated_at === "string" ? lyrics.updated_at : typeof data.updated_at === "string" ? data.updated_at : null,
  };
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) return fallback;
  try {
    const parsed = JSON.parse(error.message) as { detail?: unknown; error?: unknown };
    const detail = parsed.detail ?? parsed.error;
    if (typeof detail === "string" && detail.trim()) return detail;
  } catch {
    // Keep the original message below.
  }
  return error.message;
}

export function Album() {
  const {
    albumId: albumIdParam,
    artistSlug,
    albumSlug,
  } = useParams<{ albumId?: string; artistSlug?: string; albumSlug?: string }>();
  const albumId = albumIdParam ? Number(albumIdParam) : undefined;
  const { data, loading, refetch } = useApi<AlbumData>(
    albumApiPath({
      albumId,
      artistSlug,
      albumSlug,
    }) || null,
  );
  const [showTags, setShowTags] = useState(false);
  const [matches, setMatches] = useState<MatchResult[] | null>(null);
  const [matching, setMatching] = useState(false);
  const [pendingMatch, setPendingMatch] = useState<MatchResult | null>(null);
  const [analysisData, setAnalysisData] = useState<Record<string, AudioAnalysisTrack> | null>(null);
  const [lyricsTaskId, setLyricsTaskId] = useState<string | null>(null);
  const [lyricsOverrides, setLyricsOverrides] = useState<Record<string, TrackLyricsStatus>>({});
  const [syncingLyricsTrackKey, setSyncingLyricsTrackKey] = useState<string | null>(null);
  const processedLyricsEventIds = useRef<Set<number | string>>(new Set());
  const { events: lyricsEvents, done: lyricsTaskDone } = useTaskEvents(lyricsTaskId);

  useEffect(() => {
    const endpoint = artistActionApiPath({ artistId: data?.artist_id, artistEntityUid: data?.artist_entity_uid }, "analysis-data");
    if (!endpoint) return;
    api<Record<string, AudioAnalysisTrack>>(endpoint)
      .then((d) => { if (d && Object.keys(d).length > 0) setAnalysisData(d); })
      .catch(() => {});
  }, [data?.artist_entity_uid, data?.artist_id]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (albumId == null || !data?.artist_slug || !data?.slug) return;
    navigate(
      albumPagePath({
        artistSlug: data.artist_slug,
        artistName: data.artist,
        albumSlug: data.slug,
        albumName: data.name,
      }),
      { replace: true },
    );
  }, [albumId, data?.artist_slug, data?.artist, data?.slug, data?.name, navigate]);

  useEffect(() => {
    setLyricsOverrides({});
    setSyncingLyricsTrackKey(null);
    processedLyricsEventIds.current.clear();
  }, [data?.id, data?.entity_uid]);

  useEffect(() => {
    processedLyricsEventIds.current.clear();
  }, [lyricsTaskId]);

  useEffect(() => {
    if (!lyricsTaskId || lyricsEvents.length === 0) return;

    const updates: Record<string, TrackLyricsStatus> = {};
    for (const event of lyricsEvents) {
      if (event.type !== "lyrics_track") continue;
      const eventId = event.id ?? `${event.timestamp}:${event.data.track_id ?? event.data.track_entity_uid ?? event.data.path ?? ""}`;
      if (processedLyricsEventIds.current.has(eventId)) continue;
      processedLyricsEventIds.current.add(eventId);
      const key = lyricOverrideKeyFromEvent(event.data);
      if (!key) continue;
      updates[key] = lyricsStatusFromTaskEvent(event.data);
      if (syncingLyricsTrackKey === key) {
        setSyncingLyricsTrackKey(null);
      }
    }
    if (Object.keys(updates).length === 0) return;
    setLyricsOverrides((prev) => ({ ...prev, ...updates }));
  }, [lyricsEvents, lyricsTaskId, syncingLyricsTrackKey]);

  useEffect(() => {
    if (!lyricsTaskId || !lyricsTaskDone) return;
    if (lyricsTaskDone.status === "completed") {
      refetch();
    }
    setSyncingLyricsTrackKey(null);
    setLyricsTaskId(null);
  }, [lyricsTaskDone, lyricsTaskId, refetch]);

  const tableTracks = useMemo(() => {
    return (data?.tracks ?? []).map((track) => {
      const override = lyricOverrideKeysForTrack(track).map((key) => lyricsOverrides[key]).find(Boolean);
      return override ? { ...track, lyrics: override } : track;
    });
  }, [data?.tracks, lyricsOverrides]);

  async function findMatches() {
    const endpoint = albumMatchApiPath({ albumId: data?.id, albumEntityUid: data?.entity_uid });
    if (!endpoint) return;
    setMatching(true);
    try {
      const results = await api<MatchResult[]>(endpoint);
      setMatches(Array.isArray(results) ? results : []);
    } catch (error) {
      setMatches(null);
      toast.error(apiErrorMessage(error, "Failed to search MusicBrainz matches"));
    } finally {
      setMatching(false);
    }
  }

  async function queueTrackLyricsSync(track: AlbumData["tracks"][number]) {
    const trackId = track.id;
    const trackEntityUid = track.entity_uid;
    if (trackId == null && !trackEntityUid) {
      toast.error("Track reference missing");
      return;
    }

    setSyncingLyricsTrackKey(primaryLyricOverrideKeyForTrack(track));
    try {
      const response = await api<{ task_id: string }>("/api/manage/sync-lyrics", "POST", {
        track_id: trackId,
        track_entity_uid: trackEntityUid,
        force: true,
        limit: 1,
        delay_seconds: 0,
      });
      setLyricsTaskId(response.task_id);
      toast.success("Lyrics sync queued");
    } catch (error) {
      setSyncingLyricsTrackKey(null);
      toast.error(apiErrorMessage(error, "Failed to queue lyrics sync"));
    }
  }

  async function applyMatch(match: MatchResult) {
    if (!data?.entity_uid && data?.id == null) return;
    try {
      const { task_id } = await api<{ task_id: string }>("/api/match/apply", "POST", {
        album_id: data.id,
        album_entity_uid: data.entity_uid,
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
        <div className="mx-auto w-full max-w-[1480px] px-4 pt-6 md:px-8">
          <Skeleton className="mb-4 h-6 w-48" />
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return <div className="text-center py-12 text-muted-foreground">Not found</div>;

  const hasMusicBrainzAlbumId = Boolean(data.album_tags.musicbrainz_albumid?.trim());

  return (
    <div className="-mt-16 md:-mt-[6.5rem]">
        <AlbumHeader
          albumId={data.id}
          albumEntityUid={data.entity_uid}
          albumSlug={data.slug}
          artistId={data.artist_id}
          artistEntityUid={data.artist_entity_uid}
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
            const endpoint = artistActionApiPath({ artistId: data?.artist_id, artistEntityUid: data?.artist_entity_uid }, "analysis-data");
            if (!endpoint) return;
            api<Record<string, AudioAnalysisTrack>>(endpoint)
              .then((d) => { if (d && Object.keys(d).length > 0) setAnalysisData(d); })
              .catch(() => {});
          }}
          onMetadataTaskQueued={(action: AlbumMetadataAction, taskId: string) => {
            if (action === "lyrics") setLyricsTaskId(taskId);
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
          {!hasMusicBrainzAlbumId ? (
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
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="border-white/20 text-white/70 hover:text-white hover:bg-white/10"
            onClick={async () => {
              try {
                const endpoint = albumReanalyzeApiPath({ albumId: data.id, albumEntityUid: data.entity_uid });
                if (!endpoint) throw new Error("album reference missing");
                await api(endpoint, "POST");
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

      <div className="mx-auto w-full max-w-[1480px] px-4 pb-12 pt-6 md:px-8">
        {showTags && data.id != null && (
          <TagEditor
            albumId={data.id}
            albumEntityUid={data.entity_uid}
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
            tracks={tableTracks}
            artist={data.artist}
            artistId={data.artist_id}
            artistSlug={data.artist_slug}
            album={data.name}
            albumId={data.id}
            albumSlug={data.slug}
            albumCover={albumCoverApiUrl({ albumId: data.id, albumEntityUid: data.entity_uid, albumSlug: data.slug, artistName: data.artist, albumName: data.name })}
            analysisData={analysisData ?? undefined}
            syncingLyricsTrackKey={syncingLyricsTrackKey}
            onSyncTrackLyrics={queueTrackLyricsSync}
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
              const endpoint = albumManagementApiPath({ albumId: data.id, albumEntityUid: data.entity_uid }, "delete");
              if (!endpoint) throw new Error("album reference missing");
              await api<{ task_id: string }>(endpoint, "POST", { mode: "full" });
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
