import { useNavigate } from "react-router";
import {
  Calendar,
  Play,
  RadioTower,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { fetchPlayableSetlist } from "@/lib/upcoming";
import { usePlayer, usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import {
  ContinueListeningSection,
  HomeReplaySection,
  KeepQueueMovingSection,
} from "@/components/home/HomePlaybackSections";
import {
  FeaturedPlaylistCard,
  SectionHeader,
  SectionLoading,
  SectionRail,
  UpcomingPreviewRow,
  getHomeDateString,
  getHomeGreeting,
} from "@/components/home/HomeSections";
import type {
  CuratedPlaylist,
  HomeUpcomingInsight,
  HomeUpcomingResponse,
  LibraryAddition,
  PaginatedArtistsResponse,
  PlaylistDetailData,
  ReplayMix,
  SavedAlbum,
  UserPlaylist,
} from "@/components/home/home-model";
import { encPath } from "@/lib/utils";

export function Home() {
  const navigate = useNavigate();
  const { currentTrack, recentlyPlayed } = usePlayer();
  const { play, playAll } = usePlayerActions();

  const { data: curatedPlaylists, loading: curatedLoading } =
    useApi<CuratedPlaylist[]>("/api/curation/playlists");
  const { data: followedCurated, loading: followedLoading, refetch: refetchFollowedCurated } =
    useApi<CuratedPlaylist[]>("/api/curation/followed");
  const { data: recentGlobalArtists, loading: globalArtistsLoading } =
    useApi<PaginatedArtistsResponse>("/api/artists?sort=recent&per_page=10");
  const { data: savedAlbums, loading: savedAlbumsLoading } =
    useApi<SavedAlbum[]>("/api/me/albums");
  const { data: playlists, loading: playlistsLoading } =
    useApi<UserPlaylist[]>("/api/playlists");
  const { data: upcoming } =
    useApi<HomeUpcomingResponse>("/api/me/upcoming");
  const { data: replay } =
    useApi<ReplayMix>("/api/me/stats/replay?window=30d&limit=18");

  const continueItems = currentTrack
    ? [currentTrack, ...recentlyPlayed.filter((track) => track.id !== currentTrack.id)]
    : recentlyPlayed;
  const continueLead = continueItems[0];
  const continueRail = continueItems.slice(1, 8);
  const upcomingPreview = (upcoming?.items || [])
    .filter((item) => item.is_upcoming)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 3);
  const nextUpcoming = upcomingPreview[0] || null;
  const nextUpcomingDate = nextUpcoming?.date
    ? new Date(`${nextUpcoming.date}T12:00:00`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      })
    : null;
  const homeInsights = (upcoming?.insights || []).slice(0, 2);
  const replayPreview = (replay?.items || []).slice(0, 4);
  const libraryAdditions: LibraryAddition[] = [
    ...((playlists || []).map((playlist) => ({
      type: "playlist" as const,
      added_at: playlist.updated_at || playlist.created_at || "",
      playlist_id: playlist.id,
      playlist_name: playlist.name,
      playlist_description: playlist.description,
      playlist_tracks: playlist.artwork_tracks,
      playlist_cover_data_url: playlist.cover_data_url,
      playlist_track_count: playlist.track_count,
      playlist_badge: "Playlist",
    }))),
    ...((followedCurated || []).map((playlist) => ({
      type: "system_playlist" as const,
      added_at: playlist.followed_at || playlist.updated_at || "",
      playlist_id: playlist.id,
      playlist_name: playlist.name,
      playlist_description: playlist.description,
      playlist_tracks: playlist.artwork_tracks,
      playlist_track_count: playlist.track_count,
      playlist_follower_count: playlist.follower_count,
      playlist_badge: playlist.is_smart ? "Smart" : "Curated",
    }))),
    ...((savedAlbums || []).map((album) => ({
      type: "album" as const,
      added_at: album.saved_at || "",
      album_id: album.id,
      album_name: album.name,
      album_artist: album.artist,
      album_year: album.year,
      album_track_count: album.track_count,
    }))),
  ]
    .sort((a, b) => b.added_at.localeCompare(a.added_at))
    .slice(0, 14);
  const libraryAdditionsLoading =
    savedAlbumsLoading || playlistsLoading || followedLoading;

  async function handlePlayPlaylist(playlistId: number, systemPlaylist: boolean, playlistName: string) {
    try {
      const data = await api<PlaylistDetailData>(
        systemPlaylist ? `/api/curation/playlists/${playlistId}` : `/api/playlists/${playlistId}`,
      );
      const playerTracks: Track[] = (data.tracks || []).map((track) => ({
        id: track.track_path || String(track.id || track.track_id || Math.random()),
        title: track.title || "Unknown",
        artist: track.artist || "",
        album: track.album || "",
        albumCover:
          track.artist && track.album
            ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`
            : data.cover_data_url || undefined,
        path: track.track_path,
        libraryTrackId: track.track_id,
        navidromeId: track.navidrome_id,
      }));
      if (playerTracks.length > 0) {
        playAll(playerTracks, 0, {
          type: "playlist",
          name: playlistName,
          radio: { seedType: "playlist", seedId: playlistId },
        });
      }
    } catch {
      toast.error("Failed to play playlist");
    }
  }

  async function handleToggleSystemPlaylistFollow(playlistId: number, isFollowed: boolean) {
    try {
      await api(`/api/curation/playlists/${playlistId}/follow`, isFollowed ? "DELETE" : "POST");
      toast.success(isFollowed ? "Removed from your library" : "Added to your library");
      refetchFollowedCurated();
    } catch {
      toast.error("Failed to update playlist");
    }
  }

  async function acknowledgeInsight(insight: HomeUpcomingInsight) {
    try {
      await api(`/api/me/shows/${insight.show_id}/reminders`, "POST", {
        reminder_type: insight.type,
      });
      toast.success("Saved for later");
      navigate("/upcoming");
    } catch {
      toast.error("Failed to save reminder");
    }
  }

  async function playInsightSetlist(insight: HomeUpcomingInsight) {
    try {
      const queue = await fetchPlayableSetlist(insight.artist);
      if (!queue.length) {
        toast.info("No probable setlist tracks matched your library");
        return;
      }
      playAll(queue, 0, { type: "playlist", name: `${insight.artist} Probable Setlist` });
      await api(`/api/me/shows/${insight.show_id}/reminders`, "POST", {
        reminder_type: insight.type,
      });
      toast.success(`Playing probable setlist: ${queue.length} tracks`);
    } catch {
      toast.error("Failed to load probable setlist");
    }
  }

  function playReplayMix() {
    if (!replay?.items?.length) return;
    const queue: Track[] = replay.items.map((item) => ({
      id: item.track_path || String(item.track_id || `${item.artist}-${item.title}`),
      title: item.title,
      artist: item.artist,
      album: item.album,
      path: item.track_path || undefined,
      libraryTrackId: item.track_id || undefined,
      albumCover: item.artist && item.album
        ? `/api/cover/${encPath(item.artist)}/${encPath(item.album)}`
        : undefined,
    }));
    playAll(queue, 0, { type: "playlist", name: replay.title });
  }

  return (
    <div className="space-y-10">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{getHomeGreeting()}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{getHomeDateString()}</p>
        </div>

        <ContinueListeningSection
          continueLead={continueLead}
          continueRail={continueRail}
          onPlayTrack={(track, sourceName) => play(track, { type: "track", name: sourceName })}
        />
      </div>

      {upcomingPreview.length > 0 ? (
        <section className="space-y-4">
          <SectionHeader
            title="Upcoming"
            subtitle="Next shows and releases from the artists you follow."
            actionLabel="Open Upcoming"
            onAction={() => navigate("/upcoming")}
          />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
                <RadioTower size={12} />
                From your artists
              </div>
              {nextUpcoming ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-white/55">
                      {nextUpcoming.type === "show" ? "Next show" : "Next release"}
                    </div>
                    {nextUpcoming.user_attending && nextUpcoming.type === "show" ? (
                      <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-primary">
                        Going
                      </div>
                    ) : null}
                  </div>
                  <h2 className="mt-4 text-2xl font-bold text-foreground">
                    {nextUpcoming.type === "show" ? nextUpcoming.artist : nextUpcoming.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {nextUpcoming.type === "show"
                      ? `${nextUpcoming.title} · ${nextUpcoming.subtitle}`
                      : `${nextUpcoming.artist} · ${nextUpcoming.subtitle}`}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {nextUpcomingDate ? (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">Date</div>
                        <div className="mt-1 text-sm font-semibold text-foreground">{nextUpcomingDate}</div>
                      </div>
                    ) : null}
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">Shows</div>
                      <div className="mt-1 text-sm font-semibold text-foreground">{upcoming?.summary.show_count ?? 0}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">Releases</div>
                      <div className="mt-1 text-sm font-semibold text-foreground">{upcoming?.summary.release_count ?? 0}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => navigate("/upcoming")}
                    className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Calendar size={15} />
                    View details
                  </button>
                </>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/40">
                <Calendar size={12} />
                Next up
              </div>
              <div className="space-y-1">
                {upcomingPreview.map((item) => (
                  <UpcomingPreviewRow
                    key={`${item.type}-${item.artist}-${item.title}-${item.date}`}
                    item={item}
                    onClick={() => navigate("/upcoming")}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {homeInsights.length > 0 ? (
        <section className="space-y-4">
          <SectionHeader
            title="Show prep"
            subtitle="A couple of timely prompts from the shows you're planning to attend."
            actionLabel="Open Upcoming"
            onAction={() => navigate("/upcoming")}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            {homeInsights.map((insight) => (
              <div
                key={`${insight.type}:${insight.show_id}`}
                className="rounded-[24px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.16),transparent_42%),rgba(255,255,255,0.03)] p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
                      <Sparkles size={12} />
                      {insight.type === "show_prep" ? "Show prep" : insight.type === "one_week" ? "This week" : "One month"}
                    </div>
                    <h3 className="mt-3 text-lg font-bold text-foreground">{insight.title}</h3>
                    <p className="mt-1 text-sm text-white/60">{insight.subtitle}</p>
                  </div>
                  {insight.weight === "high" ? (
                    <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-primary">
                      Heavy rotation
                    </div>
                  ) : null}
                </div>

                <p className="mt-4 text-sm leading-6 text-muted-foreground">{insight.message}</p>

                <div className="mt-5 flex flex-wrap gap-2">
                  {insight.has_setlist ? (
                    <button
                      onClick={() => void playInsightSetlist(insight)}
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      <Play size={14} fill="currentColor" />
                      Play probable setlist
                    </button>
                  ) : null}
                  <button
                    onClick={() => void acknowledgeInsight(insight)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/65 transition-colors hover:border-white/20 hover:text-foreground"
                  >
                    <Calendar size={14} />
                    Save for later
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <HomeReplaySection
        replay={replay || undefined}
        replayPreview={replayPreview}
        onOpenStats={() => navigate("/stats")}
        onPlayReplay={playReplayMix}
        onPlayTrack={(item) =>
          play(
            {
              id: item.track_path || String(item.track_id || `${item.artist}-${item.title}`),
              title: item.title,
              artist: item.artist,
              album: item.album,
              path: item.track_path || undefined,
              libraryTrackId: item.track_id || undefined,
              albumCover: item.artist && item.album
                ? `/api/cover/${encPath(item.artist)}/${encPath(item.album)}`
                : undefined,
            },
            { type: "track", name: item.title },
          )
        }
      />

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
              <FeaturedPlaylistCard
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
          subtitle="Your latest playlists and saved albums in one place."
          actionLabel="Go to Library"
          onAction={() => navigate("/library")}
        />

        {libraryAdditionsLoading ? (
          <SectionLoading />
        ) : libraryAdditions.length > 0 ? (
          <SectionRail>
            {libraryAdditions.map((item) => {
              if (
                (item.type === "playlist" || item.type === "system_playlist") &&
                item.playlist_id &&
                item.playlist_name
              ) {
                const isSystem = item.type === "system_playlist";
                const playlistMeta = isSystem
                  ? `${item.playlist_track_count || 0} tracks${item.playlist_follower_count != null ? ` · ${item.playlist_follower_count} followers` : ""}`
                  : `${item.playlist_track_count || 0} tracks`;
                return (
                  <PlaylistCard
                    key={`${item.type}-${item.playlist_id}-${item.added_at}`}
                    name={item.playlist_name}
                    description={item.playlist_description}
                    tracks={item.playlist_tracks}
                    coverDataUrl={item.playlist_cover_data_url}
                    meta={playlistMeta}
                    systemPlaylist={isSystem}
                    isFollowed={isSystem}
                    badge={item.playlist_badge}
                    onPlay={() => handlePlayPlaylist(item.playlist_id!, isSystem, item.playlist_name!)}
                    onToggleFollow={
                      isSystem
                        ? () => handleToggleSystemPlaylistFollow(item.playlist_id!, true)
                        : undefined
                    }
                    onClick={() =>
                      navigate(isSystem ? `/curation/playlist/${item.playlist_id}` : `/playlist/${item.playlist_id}`)
                    }
                  />
                );
              }

              if (item.album_id && item.album_name && item.album_artist) {
                return (
                  <AlbumCard
                    key={`album-${item.album_id}-${item.added_at}`}
                    artist={item.album_artist}
                    album={item.album_name}
                    albumId={item.album_id}
                    year={item.album_year}
                  />
                );
              }

              return null;
            })}
          </SectionRail>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
            Start saving albums or creating playlists and they will show up here.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Just landed"
          subtitle="Fresh additions arriving in the shared Crate library."
          actionLabel="Explore"
          onAction={() => navigate("/explore")}
        />
        {globalArtistsLoading ? (
          <SectionLoading />
        ) : recentGlobalArtists?.items?.length ? (
          <SectionRail>
            {recentGlobalArtists.items.map((artist) => (
              <ArtistCard
                key={`just-landed-${artist.name}`}
                name={artist.name}
                subtitle={`${artist.albums ?? artist.album_count ?? 0} album${(artist.albums ?? artist.album_count ?? 0) === 1 ? "" : "s"} · ${artist.tracks ?? artist.track_count ?? 0} tracks`}
              />
            ))}
          </SectionRail>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
            No recent global additions yet.
          </div>
        )}
      </section>

      <KeepQueueMovingSection
        tracks={continueRail}
        onPlayTrack={(track) => play(track, { type: "track", name: "Quick Pick" })}
      />
    </div>
  );
}
