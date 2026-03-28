import { useParams, useNavigate } from "react-router";
import { Play, Shuffle, ListPlus, Clock, Disc } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { TrackRow } from "@/components/cards/TrackRow";
import { encPath, formatBadgeClass } from "@/lib/utils";

interface AlbumTrack {
  id: number;
  filename: string;
  format: string;
  size_mb: number;
  bitrate: number | null;
  length_sec: number;
  rating: number;
  tags: {
    title: string;
    artist: string;
    album: string;
    albumartist: string;
    tracknumber: string;
    discnumber: string;
    date: string;
    genre: string;
    musicbrainz_albumid: string;
    musicbrainz_trackid: string;
  };
  path: string;
}

interface AlbumData {
  artist: string;
  name: string;
  display_name: string;
  path: string;
  track_count: number;
  total_size_mb: number;
  total_length_sec: number;
  has_cover: boolean;
  cover_file: string | null;
  tracks: AlbumTrack[];
  album_tags: {
    artist: string;
    album: string;
    year: string;
    genre: string;
    musicbrainz_albumid: string | null;
  };
  genres: string[];
}

function buildPlayerTracks(data: AlbumData): Track[] {
  const cover = `/api/cover/${encPath(data.artist)}/${encPath(data.name)}`;
  return data.tracks.map((t) => ({
    id: t.path || String(t.id),
    title: t.tags.title || t.filename,
    artist: data.artist,
    album: data.display_name || data.name,
    albumCover: cover,
  }));
}

function formatTotalDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
}

export function Album() {
  const { artist, album } = useParams<{ artist: string; album: string }>();
  const navigate = useNavigate();
  const { playAll, addToQueue } = usePlayerActions();

  const decodedArtist = decodeURIComponent(artist || "");
  const decodedAlbum = decodeURIComponent(album || "");

  const { data, loading, error } = useApi<AlbumData>(
    decodedArtist && decodedAlbum
      ? `/api/album/${encPath(decodedArtist)}/${encPath(decodedAlbum)}`
      : null,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Album not found</p>
      </div>
    );
  }

  const coverUrl = `/api/cover/${encPath(data.artist)}/${encPath(data.name)}`;
  const displayName = data.display_name || data.name;
  const year = data.album_tags?.year?.slice(0, 4);
  const genre = data.genres.length > 0 ? data.genres.join(", ") : data.album_tags?.genre;
  const playerTracks = buildPlayerTracks(data);

  const formats = [...new Set(data.tracks.map((t) => t.format).filter(Boolean))];
  const hasMultipleDiscs = data.tracks.some(
    (t) => t.tags.discnumber && parseInt(t.tags.discnumber) > 1,
  );

  const handlePlay = (startIndex = 0) => {
    if (playerTracks.length > 0) playAll(playerTracks, startIndex);
  };

  const handleShuffle = () => {
    if (playerTracks.length === 0) return;
    const shuffled = [...playerTracks].sort(() => Math.random() - 0.5);
    playAll(shuffled);
  };

  const handleAddToQueue = () => {
    playerTracks.forEach((t) => addToQueue(t));
  };

  // Group tracks by disc if multi-disc
  const tracksByDisc = new Map<number, AlbumTrack[]>();
  for (const t of data.tracks) {
    const disc = parseInt(t.tags.discnumber) || 1;
    if (!tracksByDisc.has(disc)) tracksByDisc.set(disc, []);
    tracksByDisc.get(disc)!.push(t);
  }

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      {/* Header */}
      <div className="px-4 sm:px-6 pt-6 pb-4">
        <div className="flex flex-col sm:flex-row gap-6">
          {/* Cover */}
          <div className="flex-shrink-0 w-[200px] sm:w-[240px] lg:w-[280px] mx-auto sm:mx-0">
            <div className="aspect-square rounded-lg overflow-hidden bg-white/5 shadow-2xl">
              {data.has_cover ? (
                <img
                  src={coverUrl}
                  alt={displayName}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Disc size={64} className="text-white/10" />
                </div>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="flex flex-col justify-end sm:text-left text-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1.5">{displayName}</h1>
            <button
              className="text-sm text-muted-foreground hover:text-primary transition-colors mb-3"
              onClick={() => navigate(`/artist/${encPath(data.artist)}`)}
            >
              {data.artist}
            </button>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground justify-center sm:justify-start">
              {year && <span>{year}</span>}
              {genre && <span>{genre}</span>}
              {data.track_count > 0 && (
                <span>{data.track_count} tracks</span>
              )}
              {data.total_length_sec > 0 && (
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {formatTotalDuration(data.total_length_sec)}
                </span>
              )}
              {formats.map((f) => (
                <span key={f} className={formatBadgeClass(f)}>{f}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Action Row */}
      <div className="flex items-center gap-3 px-4 sm:px-6 pb-4">
        <button
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
          onClick={() => handlePlay()}
        >
          <Play size={16} fill="currentColor" />
          Play
        </button>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/15 text-sm text-foreground hover:bg-white/5 transition-colors"
          onClick={handleShuffle}
        >
          <Shuffle size={15} />
          Shuffle
        </button>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/15 text-sm text-foreground hover:bg-white/5 transition-colors"
          onClick={handleAddToQueue}
        >
          <ListPlus size={15} />
          Queue
        </button>
      </div>

      {/* Track List */}
      <div className="px-4 sm:px-6 pb-8">
        {hasMultipleDiscs ? (
          [...tracksByDisc.entries()]
            .sort(([a], [b]) => a - b)
            .map(([disc, tracks]) => (
              <div key={disc} className="mb-4">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Disc size={12} />
                  Disc {disc}
                </div>
                {tracks.map((t, idx) => (
                  <TrackRow
                    key={t.id}
                    track={{
                      id: String(t.id),
                      title: t.tags.title || t.filename,
                      artist: data.artist,
                      album: displayName,
                      duration: t.length_sec,
                      path: t.path,
                      track_number: parseInt(t.tags.tracknumber) || idx + 1,
                      format: t.format,
                      navidrome_id: undefined,
                    }}
                    index={parseInt(t.tags.tracknumber) || idx + 1}
                    albumCover={coverUrl}
                  />
                ))}
              </div>
            ))
        ) : (
          data.tracks.map((t, idx) => (
            <TrackRow
              key={t.id}
              track={{
                id: String(t.id),
                title: t.tags.title || t.filename,
                artist: data.artist,
                album: displayName,
                duration: t.length_sec,
                path: t.path,
                track_number: parseInt(t.tags.tracknumber) || idx + 1,
                format: t.format,
                navidrome_id: undefined,
              }}
              index={parseInt(t.tags.tracknumber) || idx + 1}
              albumCover={coverUrl}
            />
          ))
        )}
      </div>
    </div>
  );
}
