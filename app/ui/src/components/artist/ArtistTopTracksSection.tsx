import { MusicContextMenu } from "@/components/ui/music-context-menu";
import type { TopTrack } from "@/hooks/use-artist-data";
import { PopularityBar } from "@/components/artist/ArtistPageBits";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { formatCompact, formatDuration, formatDurationMs } from "@/lib/utils";
import { Pause, Play } from "lucide-react";

interface SpotifyTopTrack {
  name: string;
  album: string;
  duration_ms: number;
  popularity: number;
}

interface ArtistTopTracksSectionProps {
  topTracks: TopTrack[];
  spotifyTopTracks?: SpotifyTopTrack[];
  currentTrackId?: string;
  trackPlaying: boolean;
  onPause: () => void;
  onResume: () => void;
  onPlayTopTrack: (track: TopTrack, index: number) => void;
}

export function ArtistTopTracksSection({
  topTracks,
  spotifyTopTracks,
  currentTrackId,
  trackPlaying,
  onPause,
  onResume,
  onPlayTopTrack,
}: ArtistTopTracksSectionProps) {
  if (topTracks.length === 0 && !(spotifyTopTracks?.length)) {
    return <div className="text-center py-12 text-muted-foreground">No top tracks available</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-4 px-4 py-2 text-xs text-white/30 border-b border-white/5 mb-1">
        <span className="w-8 text-right">#</span>
        <span className="flex-1">Title</span>
        <span className="w-32 hidden sm:block">Album</span>
        <span className="w-20 text-right">Duration</span>
        <span className="w-20 text-right hidden sm:block">Popularity</span>
        <span className="w-8" />
      </div>
      <div className="space-y-0.5">
        {topTracks.map((track, index) => {
          const isCurrent = currentTrackId === track.id;
          const isCurrentPlaying = isCurrent && trackPlaying;
          const coverUrl = albumCoverApiUrl({
            albumId: track.album_id,
            albumSlug: track.album_slug,
            artistName: track.artist,
            albumName: track.album,
          }) || undefined;
          return (
            <MusicContextMenu
              key={`nd-${track.id}`}
              type="track"
              artist={track.artist}
              artistId={track.artist_id}
              artistSlug={track.artist_slug}
              album={track.album || ""}
              albumId={track.album_id}
              albumSlug={track.album_slug}
              trackId={track.id}
              trackTitle={track.title}
              albumCover={coverUrl}
            >
              <button
                onClick={() => {
                  if (isCurrentPlaying) onPause();
                  else if (isCurrent) onResume();
                  else onPlayTopTrack(track, index);
                }}
                className={`w-full flex items-center gap-4 px-4 py-2.5 rounded-lg hover:bg-white/5 transition-colors group text-left ${
                  isCurrent ? "bg-white/[0.03]" : ""
                }`}
              >
                {isCurrent ? (
                  isCurrentPlaying ? (
                    <Pause size={14} className="text-primary w-8 text-right fill-current" />
                  ) : (
                    <Play size={14} className="text-primary w-8 text-right fill-current" />
                  )
                ) : (
                  <>
                    <span className="w-8 text-right text-sm text-white/30 group-hover:hidden">{index + 1}</span>
                    <Play size={14} className="text-primary hidden group-hover:block w-8 text-right fill-current" />
                  </>
                )}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium truncate ${isCurrent ? "text-primary" : "text-white/90"}`}>
                    {track.title}
                  </div>
                </div>
                <div className="w-32 hidden sm:block text-xs text-white/40 truncate">{track.album}</div>
                <div className="w-20 text-right text-xs text-white/30">{formatDuration(track.duration)}</div>
                <div className="w-20 text-right hidden sm:block">
                  {track.listeners ? <span className="text-xs text-white/30">{formatCompact(track.listeners)}</span> : null}
                </div>
                <div className="w-8" />
              </button>
            </MusicContextMenu>
          );
        })}

        {spotifyTopTracks
          ?.filter((spotifyTrack) => !topTracks.some((track) => track.title.toLowerCase() === spotifyTrack.name.toLowerCase()))
          .map((spotifyTrack, index) => (
            <div
              key={`sp-${index}`}
              className="w-full flex items-center gap-4 px-4 py-2.5 rounded-lg hover:bg-white/5 transition-colors text-left opacity-60"
            >
              <span className="w-8 text-right text-sm text-white/30">{topTracks.length + index + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white/70 truncate">{spotifyTrack.name}</div>
              </div>
              <div className="w-32 hidden sm:block text-xs text-white/40 truncate">{spotifyTrack.album}</div>
              <div className="w-20 text-right text-xs text-white/30">{formatDurationMs(spotifyTrack.duration_ms)}</div>
              <div className="w-20 text-right hidden sm:block">
                <PopularityBar value={spotifyTrack.popularity} />
              </div>
              <div className="w-8" />
            </div>
          ))}
      </div>
    </div>
  );
}
