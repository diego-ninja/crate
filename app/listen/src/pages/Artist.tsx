import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import {
  ChevronDown,
  Play,
  Radio,
  Share2,
  Shuffle,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { TrackRow } from "@/components/cards/TrackRow";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import {
  artistShowToUpcomingItem,
  groupByMonth,
  UpcomingMonthGroup,
  type ArtistShowEvent,
} from "@/components/upcoming/UpcomingRows";
import { AppModal, ModalBody, ModalCloseButton, ModalHeader } from "@/components/ui/AppModal";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { encPath, formatCompact } from "@/lib/utils";

interface ArtistAlbum {
  id: number;
  name: string;
  display_name: string;
  tracks: number;
  formats: string[];
  size_mb: number;
  year: string;
  has_cover: boolean;
}

interface ArtistData {
  name: string;
  albums: ArtistAlbum[];
  total_tracks: number;
  total_size_mb: number;
  primary_format: string | null;
  genres: string[];
  issue_count: number;
}

interface ArtistInfo {
  bio: string;
  tags: string[];
  similar: { name: string; match: number }[];
  listeners: number;
  playcount: number;
  image_url: string | null;
  url: string;
}

interface ArtistTopTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  track: number;
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

export function Artist() {
  const { name } = useParams<{ name: string }>();
  const decodedName = decodeURIComponent(name || "");
  const [bioModalOpen, setBioModalOpen] = useState(false);
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const { playAll } = usePlayerActions();

  useEffect(() => {
    if (!decodedName) return;
    api<{ following: boolean }>(`/api/me/follows/${encPath(decodedName)}`)
      .then((d) => setFollowing(d.following))
      .catch(() => {});
  }, [decodedName]);

  async function toggleFollow() {
    if (!decodedName) return;
    try {
      if (following) {
        await api(`/api/me/follows/${encPath(decodedName)}`, "DELETE");
        setFollowing(false);
        toast.success(`Unfollowed ${decodedName}`);
      } else {
        await api("/api/me/follows", "POST", { artist_name: decodedName });
        setFollowing(true);
        toast.success(`Following ${decodedName}`);
      }
    } catch {
      toast.error("Failed to update follow status");
    }
  }

  async function handleShare() {
    if (!decodedName) return;
    const shareUrl = `${window.location.origin}/artist/${encPath(decodedName)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: decodedName, text: decodedName, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Artist link copied");
      }
    } catch {
      toast.error("Failed to share artist");
    }
  }

  const { data, loading, error } = useApi<ArtistData>(
    decodedName ? `/api/artist/${encPath(decodedName)}` : null,
  );
  const { data: info } = useApi<ArtistInfo>(
    decodedName ? `/api/artist/${encPath(decodedName)}/info` : null,
  );
  const { data: topTracks } = useApi<ArtistTopTrack[]>(
    decodedName ? `/api/navidrome/artist/${encPath(decodedName)}/top-tracks?count=12` : null,
  );
  const { data: showsData } = useApi<{ events: ArtistShowEvent[] }>(
    decodedName ? `/api/artist/${encPath(decodedName)}/shows?limit=12` : null,
  );

  const coverFallback = data?.albums?.[0]
    ? `/api/cover/${encPath(data.name)}/${encPath(data.albums[0]!.name)}`
    : undefined;

  const playerTracks = useMemo<Track[]>(() => {
    if (!topTracks?.length) return [];
    return topTracks.map((track) => {
      const isPath = track.id.includes("/");
      const cover = track.artist && track.album
        ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`
        : coverFallback;
      return {
        id: isPath ? track.id : track.id,
        title: track.title || "Unknown",
        artist: track.artist || decodedName,
        album: track.album,
        albumCover: cover,
        path: isPath ? track.id : undefined,
        navidromeId: isPath ? undefined : track.id,
      };
    });
  }, [coverFallback, decodedName, topTracks]);

  async function handleArtistRadio() {
    if (!decodedName) return;
    try {
      const radioTracks = await api<ArtistTopTrack[]>(`/api/artist-radio/${encPath(decodedName)}?limit=50`);
      if (!radioTracks?.length) {
        toast.info("Artist radio is not available yet");
        return;
      }

      const queue: Track[] = radioTracks.map((track) => ({
        id: track.id,
        title: track.title || "Unknown",
        artist: track.artist || decodedName,
        album: track.album,
        albumCover: track.artist && track.album
          ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`
          : coverFallback,
        path: track.id.includes("/") ? track.id : undefined,
        navidromeId: track.id.includes("/") ? undefined : track.id,
      }));

      playAll(queue, 0, { type: "radio", name: `${decodedName} Radio` });
    } catch {
      toast.error("Failed to start artist radio");
    }
  }

  function handlePlayTopTracks(startIndex = 0, shuffle = false) {
    if (!playerTracks.length) {
      toast.info("No top tracks available for this artist yet");
      return;
    }

    const queue = shuffle ? shuffleArray(playerTracks) : playerTracks;
    playAll(queue, shuffle ? 0 : startIndex, { type: "album", name: `${decodedName} Top Tracks` });
  }

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
        <p className="text-muted-foreground">Artist not found</p>
      </div>
    );
  }

  const photoUrl = `/api/artist/${encPath(data.name)}/photo`;
  const tags = data.genres.length > 0 ? data.genres : (info?.tags ?? []);
  const similarArtists = info?.similar ?? [];
  const bio = info?.bio ?? "";
  const artistShowItems = (showsData?.events ?? []).map(artistShowToUpcomingItem);

  const albumsSorted = [...data.albums].sort((a, b) => {
    const ya = parseInt(a.year) || 0;
    const yb = parseInt(b.year) || 0;
    return yb - ya;
  });

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      <div className="relative h-[340px] sm:h-[400px] overflow-hidden">
        <img
          src={photoUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover blur-md scale-105 opacity-30"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/78 to-background/35" />

        <div className="relative h-full flex items-end px-4 sm:px-6 pb-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-5 w-full">
            <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-full overflow-hidden bg-white/5 flex-shrink-0 shadow-2xl ring-2 ring-white/10">
              <img
                src={photoUrl}
                alt={data.name}
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>

            <div className="pb-1 max-w-3xl">
              <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-2">{data.name}</h1>

              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {info?.listeners ? (
                  <span className="flex items-center gap-1">
                    <Users size={14} />
                    {formatCompact(info.listeners)} listeners
                  </span>
                ) : null}
                {data.total_tracks > 0 && <span>{data.total_tracks} tracks</span>}
                {data.albums.length > 0 && <span>{data.albums.length} albums</span>}
              </div>

              {bio && (
                <div className="mt-3 max-w-2xl">
                  <p
                    className="text-sm text-white/70 leading-relaxed whitespace-pre-line line-clamp-3"
                  >
                    {bio}
                  </p>
                  {bio.length > 200 && (
                    <button
                      className="flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
                      onClick={() => setBioModalOpen(true)}
                    >
                      <>Show more <ChevronDown size={12} /></>
                    </button>
                  )}
                </div>
              )}

              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-4">
                  {tags.slice(0, 8).map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 text-xs rounded-full bg-white/8 text-muted-foreground border border-white/10"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-4">
        <button
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
          onClick={() => handlePlayTopTracks()}
        >
          <Play size={16} fill="currentColor" />
          Play
        </button>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/15 text-sm text-foreground hover:bg-white/5 transition-colors"
          onClick={() => handlePlayTopTracks(0, true)}
        >
          <Shuffle size={15} />
          Shuffle
        </button>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/15 text-sm text-foreground hover:bg-white/5 transition-colors"
          onClick={handleArtistRadio}
        >
          <Radio size={15} />
          Artist Radio
        </button>
        <button
          className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm transition-colors ${
            following
              ? "bg-primary/15 text-primary border border-primary/30"
              : "border border-white/15 text-foreground hover:bg-white/5"
          }`}
          onClick={toggleFollow}
        >
          {following ? <UserCheck size={15} /> : <UserPlus size={15} />}
          {following ? "Following" : "Follow"}
        </button>
        <button
          className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/15 text-sm text-foreground hover:bg-white/5 transition-colors"
          onClick={handleShare}
        >
          <Share2 size={15} />
          Share
        </button>
      </div>

      <div className="px-4 sm:px-6 pb-8 space-y-8">
        {topTracks && topTracks.length > 0 && (
          <section>
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2 className="text-lg font-semibold text-foreground">Top Tracks</h2>
              <button
                className="text-sm text-primary hover:underline"
                onClick={() => handlePlayTopTracks()}
              >
                Play Top Tracks
              </button>
            </div>
            <div className="rounded-xl bg-white/[0.02] border border-white/5">
              {topTracks.map((track, index) => (
                <TrackRow
                  key={`${track.id}-${index}`}
                  track={{
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    album: track.album,
                    duration: track.duration,
                    path: track.id.includes("/") ? track.id : undefined,
                    navidrome_id: track.id.includes("/") ? undefined : track.id,
                  }}
                  index={track.track || index + 1}
                  showAlbum
                  albumCover={track.artist && track.album
                    ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`
                    : coverFallback}
                  showCoverThumb
                />
              ))}
            </div>
          </section>
        )}

        {albumsSorted.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">Albums</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {albumsSorted.map((album) => (
                <AlbumCard
                  key={album.id}
                  artist={data.name}
                  album={album.display_name || album.name}
                  albumId={album.id}
                  year={album.year?.slice(0, 4)}
                  cover={`/api/cover/${encPath(data.name)}/${encPath(album.name)}`}
                />
              ))}
            </div>
          </section>
        )}

        {artistShowItems.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">Upcoming Shows</h2>
            <div className="space-y-3">
              {groupByMonth(artistShowItems).map(([month, monthItems]) => (
                <UpcomingMonthGroup
                  key={month}
                  month={month}
                  items={monthItems}
                  expandedId={expandedShowId}
                  onToggleExpand={setExpandedShowId}
                />
              ))}
            </div>
          </section>
        )}

        {similarArtists.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">Related Artists</h2>
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6 scrollbar-hide">
              {similarArtists.slice(0, 15).map((artist) => (
                <ArtistCard key={artist.name} name={artist.name} compact />
              ))}
            </div>
          </section>
        )}
      </div>

      <AppModal open={bioModalOpen} onClose={() => setBioModalOpen(false)} maxWidthClassName="sm:max-w-2xl">
        <ModalHeader>
          <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-5">
            <div className="flex items-start gap-4 min-w-0">
              <div className="w-16 h-16 rounded-2xl overflow-hidden bg-white/5 shadow-xl flex-shrink-0">
                <img
                  src={photoUrl}
                  alt={data.name}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl sm:text-2xl font-bold text-foreground truncate">{data.name}</h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-muted-foreground">
                  {info?.listeners ? <span>{formatCompact(info.listeners)} listeners</span> : null}
                  {info?.playcount ? <span>{formatCompact(info.playcount)} scrobbles</span> : null}
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 text-xs rounded-full bg-white/8 text-muted-foreground border border-white/10"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <ModalCloseButton
              onClick={() => setBioModalOpen(false)}
              className="w-10 h-10 border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white flex items-center justify-center flex-shrink-0"
            />
          </div>
        </ModalHeader>

        <ModalBody className="max-h-[calc(92vh-124px)] px-5 sm:px-6 py-5">
          <p className="text-sm sm:text-[15px] text-white/78 leading-7 whitespace-pre-line">
            {bio}
          </p>
        </ModalBody>
      </AppModal>
    </div>
  );
}
