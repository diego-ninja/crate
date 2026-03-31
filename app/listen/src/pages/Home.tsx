import { useNavigate } from "react-router";
import {
  ArrowRight,
  Clock3,
  Heart,
  ListMusic,
  Loader2,
  Play,
  Sparkles,
} from "lucide-react";

import { useApi } from "@/hooks/use-api";
import { usePlayer, usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";

interface NewArtist {
  name: string;
  album_count: number;
  track_count: number;
  has_photo: boolean;
  updated_at?: string;
}

interface UserPlaylist {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
}

interface CuratedPlaylist {
  id: number;
  name: string;
  description?: string;
  category?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  follower_count: number;
  is_followed: boolean;
  is_smart: boolean;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getDateString(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actionLabel && onAction ? (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {actionLabel}
          <ArrowRight size={15} />
        </button>
      ) : null}
    </div>
  );
}

function SectionRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      {children}
    </div>
  );
}

function SectionLoading() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 size={20} className="animate-spin text-primary" />
    </div>
  );
}

function PlaylistCard({
  name,
  description,
  tracks,
  coverDataUrl,
  meta,
  onClick,
  badge,
}: {
  name: string;
  description?: string;
  tracks?: PlaylistArtworkTrack[];
  coverDataUrl?: string | null;
  meta: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group w-[180px] flex-shrink-0 text-left"
    >
      <div className="relative">
        <PlaylistArtwork
          name={name}
          coverDataUrl={coverDataUrl}
          tracks={tracks}
          className="aspect-square rounded-3xl shadow-xl transition-transform group-hover:scale-[1.02]"
        />
        {badge ? (
          <div className="absolute left-3 top-3 rounded-full border border-primary/25 bg-[#0a0a0f]/80 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-primary backdrop-blur-md">
            {badge}
          </div>
        ) : null}
      </div>
      <div className="px-1 pt-3">
        <div className="truncate text-sm font-bold text-foreground">{name}</div>
        <div className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-muted-foreground">
          {description || meta}
        </div>
        <div className="mt-2 text-[11px] uppercase tracking-wider text-white/35">{meta}</div>
      </div>
    </button>
  );
}

function ContinueListeningCard({
  track,
  onPlay,
}: {
  track: Track;
  onPlay: () => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_55%)]" />
      <div className="relative flex items-center gap-4">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white/5">
          {track.albumCover ? (
            <img src={track.albumCover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white/5">
              <ListMusic size={24} className="text-white/20" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-wider text-white/45">
            <Clock3 size={11} />
            Continue listening
          </div>
          <h2 className="truncate text-xl font-bold text-foreground">{track.title}</h2>
          <p className="mt-1 truncate text-sm text-muted-foreground">{track.artist}</p>
          {track.album ? <p className="mt-1 truncate text-xs text-white/35">{track.album}</p> : null}
        </div>
        <button
          onClick={onPlay}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform group-hover:scale-105"
        >
          <Play size={18} fill="currentColor" className="ml-0.5" />
        </button>
      </div>
    </div>
  );
}

export function Home() {
  const navigate = useNavigate();
  const { currentTrack, recentlyPlayed } = usePlayer();
  const { play } = usePlayerActions();

  const { data: curatedPlaylists, loading: curatedLoading } =
    useApi<CuratedPlaylist[]>("/api/curation/playlists");
  const { data: followedCurated, loading: followedLoading } =
    useApi<CuratedPlaylist[]>("/api/curation/followed");
  const { data: newArtists, loading: artistsLoading } =
    useApi<NewArtist[]>("/api/artists?sort=recent&limit=10");
  const { data: playlists, loading: playlistsLoading } =
    useApi<UserPlaylist[]>("/api/playlists");

  const continueItems = currentTrack
    ? [currentTrack, ...recentlyPlayed.filter((track) => track.id !== currentTrack.id)]
    : recentlyPlayed;
  const continueLead = continueItems[0];
  const continueRail = continueItems.slice(1, 8);

  return (
    <div className="space-y-10">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{getGreeting()}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{getDateString()}</p>
        </div>

        {continueLead ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
            <ContinueListeningCard
              track={continueLead}
              onPlay={() => play(continueLead, { type: "track", name: "Continue Listening" })}
            />

            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/40">
                <Clock3 size={12} />
                Recent listens
              </div>
              <div className="space-y-1">
                {continueRail.length > 0 ? continueRail.slice(0, 4).map((track) => (
                  <button
                    key={track.id}
                    onClick={() => play(track, { type: "track", name: "Recent Listening" })}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-white/5"
                  >
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-white/5">
                      {track.albumCover ? (
                        <img src={track.albumCover} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-white/5">
                          <ListMusic size={16} className="text-white/20" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{track.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
                    </div>
                    <Play size={15} className="shrink-0 text-white/30" />
                  </button>
                )) : (
                  <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-muted-foreground">
                    Start playing music and your listening history will show up here.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_50%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-6">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-primary">
                <Sparkles size={12} />
                Start listening
              </div>
              <h2 className="text-2xl font-bold text-foreground">Your home should feel alive as soon as playback starts.</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Play an album, a playlist, or a curated mix and this screen will turn into your real listening surface:
                continuity, smart picks, and system playlists from Crate.
              </p>
            </div>
          </div>
        )}
      </div>

      <section className="space-y-4">
        <SectionHeader
          title="From Crate"
          subtitle="Global smart and curated playlists published from admin."
        />
        {curatedLoading ? (
          <SectionLoading />
        ) : curatedPlaylists && curatedPlaylists.length > 0 ? (
          <SectionRail>
            {curatedPlaylists.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                name={playlist.name}
                description={playlist.description}
                tracks={playlist.artwork_tracks}
                meta={`${playlist.track_count} tracks${playlist.category ? ` · ${playlist.category}` : ""}`}
                badge={playlist.is_smart ? "Smart" : "Curated"}
                onClick={() => navigate(`/curation/playlist/${playlist.id}`)}
              />
            ))}
          </SectionRail>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
            No system playlists are available yet.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="In Your Library"
          subtitle="Followed playlists, playlists you own, and new additions around your collection."
          actionLabel="Go to Library"
          onAction={() => navigate("/library?tab=playlists")}
        />

        {followedLoading ? (
          <SectionLoading />
        ) : followedCurated && followedCurated.length > 0 ? (
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-wider text-white/45">
              <Heart size={12} />
              Following
            </div>
            <SectionRail>
              {followedCurated.map((playlist) => (
                <PlaylistCard
                  key={playlist.id}
                  name={playlist.name}
                  description={playlist.description}
                  tracks={playlist.artwork_tracks}
                  meta={`${playlist.track_count} tracks · ${playlist.follower_count} followers`}
                  badge="Following"
                  onClick={() => navigate(`/curation/playlist/${playlist.id}`)}
                />
              ))}
            </SectionRail>
          </div>
        ) : null}

        {playlistsLoading ? (
          <SectionLoading />
        ) : playlists && playlists.length > 0 ? (
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-wider text-white/45">
              <ListMusic size={12} />
              Your playlists
            </div>
            <SectionRail>
              {playlists.map((playlist) => (
                <PlaylistCard
                  key={playlist.id}
                  name={playlist.name}
                  description={playlist.description}
                  tracks={playlist.artwork_tracks}
                  coverDataUrl={playlist.cover_data_url}
                  meta={`${playlist.track_count} tracks`}
                  badge={undefined}
                  onClick={() => navigate(`/playlist/${playlist.id}`)}
                />
              ))}
            </SectionRail>
          </div>
        ) : null}
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="New in Library"
          subtitle="Recently added artists you may want to dive back into."
          actionLabel="Explore"
          onAction={() => navigate("/explore")}
        />
        {artistsLoading ? (
          <SectionLoading />
        ) : newArtists && newArtists.length > 0 ? (
          <SectionRail>
            {newArtists.map((artist) => (
              <ArtistCard
                key={artist.name}
                name={artist.name}
                subtitle={`${artist.album_count} album${artist.album_count !== 1 ? "s" : ""}`}
              />
            ))}
          </SectionRail>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
            No recent library additions yet.
          </div>
        )}
      </section>

      {continueRail.length > 0 ? (
        <section className="space-y-4">
          <SectionHeader
            title="Keep the queue moving"
            subtitle="Quick picks from your own recent listening."
          />
          <SectionRail>
            {continueRail.map((track) => (
              <button
                key={track.id}
                onClick={() => play(track, { type: "track", name: "Quick Pick" })}
                className="group w-[220px] flex-shrink-0 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] text-left"
              >
                <div className="flex items-center gap-3 p-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white/5">
                    {track.albumCover ? (
                      <img src={track.albumCover} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-white/5">
                        <ListMusic size={18} className="text-white/20" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">{track.title}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{track.artist}</div>
                    {track.album ? <div className="mt-1 truncate text-[11px] text-white/35">{track.album}</div> : null}
                  </div>
                </div>
              </button>
            ))}
          </SectionRail>
        </section>
      ) : null}
    </div>
  );
}
