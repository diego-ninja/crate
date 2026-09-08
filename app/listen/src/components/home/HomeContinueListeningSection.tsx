import { Clock3, Sparkles } from "@crate/ui/icons";

import type { Track } from "@/contexts/PlayerContext";

import { ContinueListeningCard } from "./HomeSections";
import { HomeTrackRowAction } from "./HomeTrackRowAction";

export function ContinueListeningSection({
  continueLead,
  continueRail,
  onPlayTrack,
}: {
  continueLead?: Track;
  continueRail: Track[];
  onPlayTrack: (track: Track, sourceName: string) => void;
}) {
  if (!continueLead) {
    return (
      <div className="home-playback-empty-card overflow-hidden rounded-[12px] p-6">
        <div className="max-w-2xl space-y-3">
          <div className="home-playback-badge inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wider">
            <Sparkles size={12} />
            Start listening
          </div>
          <h2 className="text-2xl font-bold text-text-primary">
            Your home should feel alive as soon as playback starts.
          </h2>
          <p className="text-sm leading-6 text-text-muted">
            Play an album, a playlist, or a curated mix and this screen will
            turn into your real listening surface: continuity, smart picks, and
            system playlists from Crate.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)] xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
      <ContinueListeningCard
        track={continueLead}
        onPlay={() => onPlayTrack(continueLead, "Continue Listening")}
      />

      <div className="home-playback-panel overflow-hidden rounded-[12px] p-4">
        <div className="home-playback-panel-kicker mb-3 flex items-center gap-2 text-xs uppercase tracking-wider">
          <Clock3 size={12} />
          Recent listens
        </div>
        <div className="space-y-1">
          {continueRail.length > 0 ? (
            continueRail
              .slice(0, 4)
              .map((track) => (
                <HomeTrackRowAction
                  key={track.id}
                  track={track}
                  onPlay={() => onPlayTrack(track, "Recent Listening")}
                />
              ))
          ) : (
            <div className="home-playback-empty-state rounded-lg px-4 py-5 text-sm text-text-muted">
              Start playing music and your listening history will show up here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
