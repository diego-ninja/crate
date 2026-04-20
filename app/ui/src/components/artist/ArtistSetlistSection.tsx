import { useNavigate } from "react-router";
import { fuzzyMatchTrack } from "@/components/artist/ArtistPageBits";
import { api } from "@/lib/api";
import { albumPagePath } from "@/lib/library-routes";
import { toast } from "sonner";

interface SetlistSong {
  title: string;
  frequency: number;
  play_count: number;
  last_played?: string;
}

interface SetlistData {
  probable_setlist?: SetlistSong[];
  total_shows?: number;
  last_show?: { date: string; venue: string; city: string };
}

interface LibraryTrackTitle {
  title: string;
  album: string;
  path: string;
  album_id?: number;
  album_slug?: string;
}

interface ArtistSetlistSectionProps {
  artistName: string;
  artistId?: number;
  setlistData?: SetlistData;
  allTrackTitles: LibraryTrackTitle[];
  onTrackTitlesLoaded: (tracks: LibraryTrackTitle[]) => void;
}

export function ArtistSetlistSection({
  artistName,
  artistId,
  setlistData,
  allTrackTitles,
  onTrackTitlesLoaded,
}: ArtistSetlistSectionProps) {
  const navigate = useNavigate();
  const probableSetlist = setlistData?.probable_setlist ?? [];
  const lastShow = setlistData?.last_show;
  const totalShows = setlistData?.total_shows ?? 0;

  if (probableSetlist.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No concert data available from Setlist.fm
      </div>
    );
  }

  async function ensureTrackTitles() {
    if (artistId == null) return [];
    if (allTrackTitles.length > 0) return allTrackTitles;
    try {
      const tracks = await api<LibraryTrackTitle[]>(`/api/artists/${artistId}/track-titles`);
      if (Array.isArray(tracks)) {
        onTrackTitlesLoaded(tracks);
        return tracks;
      }
    } catch {
      // Surface the user-facing error at the call site instead.
    }
    return [];
  }

  return (
    <div className="max-w-3xl">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Probable Setlist</h2>
            <p className="text-xs text-white/40 mt-0.5">
              Based on {totalShows} recent concerts
              {lastShow && (
                <> &middot; Last show: {lastShow.date} at {lastShow.venue}, {lastShow.city}</>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 px-4 py-2 text-xs text-white/30 border-b border-white/5 mb-1">
          <span className="w-8 text-right">#</span>
          <span className="flex-1">Song</span>
          <span className="w-28">Frequency</span>
          <span className="w-16 text-right">Plays</span>
          <span className="w-24 text-right hidden sm:block">Last Played</span>
        </div>

        <div className="space-y-0.5">
          {probableSetlist.map((song, i) => {
            const libraryMatch = fuzzyMatchTrack(song.title, allTrackTitles);
            const isPlayable = !!libraryMatch;
            return (
              <button
                key={i}
                className={`w-full flex items-center gap-4 px-4 py-2.5 rounded-md hover:bg-white/5 transition-colors text-left group ${!isPlayable ? "opacity-50" : ""}`}
                onClick={() => {
                  if (libraryMatch) {
                    navigate(
                      albumPagePath({
                        albumId: libraryMatch.album_id,
                        albumSlug: libraryMatch.album_slug,
                        artistName,
                        albumName: libraryMatch.album,
                      }),
                    );
                  } else {
                    void ensureTrackTitles().catch(() => {
                      toast.error("Failed to load artist tracks");
                    });
                  }
                }}
                disabled={!isPlayable}
              >
                {isPlayable ? (
                  <>
                    <span className="w-8 text-right text-sm text-white/30">{i + 1}</span>
                  </>
                ) : (
                  <span className="w-8 text-right text-sm text-white/20">{i + 1}</span>
                )}
                <span className="flex-1 text-sm text-white/90 truncate">{song.title}</span>
                <div className="w-28 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-white/10 rounded-md overflow-hidden">
                    <div
                      className="h-full rounded-md"
                      style={{
                        width: `${Math.round(song.frequency * 100)}%`,
                        background: "linear-gradient(90deg, #88c0d0, #81a1c1)",
                      }}
                    />
                  </div>
                  <span className="text-xs text-white/40 w-8 text-right">{Math.round(song.frequency * 100)}%</span>
                </div>
                <span className="w-16 text-right text-xs text-white/40">{song.play_count}</span>
                <span className="w-24 text-right text-xs text-white/30 hidden sm:block">{song.last_played ?? "-"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
