import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";

import {
  ArtistBioModal,
} from "@/components/artist/ArtistBioModal";
import { ArtistHeroSection } from "@/components/artist/ArtistHeroSection";
import {
  ArtistAlbumsSection,
  ArtistShowsSection,
  ArtistTopTracksSection,
  RelatedArtistsSection,
} from "@/components/artist/ArtistPageSections";
import {
  buildArtistAlbumCover,
  buildArtistPhotoUrl,
  buildArtistPlayerTrack,
  buildArtistShowItems,
  sortArtistAlbumsByYear,
  type ArtistData,
  type ArtistInfo,
  type ArtistTopTrack,
  type StatsArtist,
  type StatsListResponse,
} from "@/components/artist/artist-model";
import { type ArtistShowEvent } from "@/components/upcoming/UpcomingRows";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { fetchPlayableSetlist } from "@/lib/upcoming";
import { fetchArtistRadio } from "@/lib/radio";
import { encPath, shuffleArray } from "@/lib/utils";

export function Artist() {
  const { name } = useParams<{ name: string }>();
  const decodedName = decodeURIComponent(name || "");
  const [bioModalOpen, setBioModalOpen] = useState(false);
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [localSimilarArtists, setLocalSimilarArtists] = useState<Record<string, boolean>>({});
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
  const { data: topArtistsStats } = useApi<StatsListResponse<StatsArtist>>(
    decodedName ? "/api/me/stats/top-artists?window=30d&limit=12" : null,
  );

  const coverFallback = data?.albums?.[0]
    ? buildArtistAlbumCover(data.name, data.albums[0]!.name)
    : undefined;

  const playerTracks = useMemo<Track[]>(() => {
    if (!topTracks?.length) return [];
    return topTracks.map((track) => buildArtistPlayerTrack(track, decodedName, coverFallback));
  }, [coverFallback, decodedName, topTracks]);

  async function handleArtistRadio() {
    if (!decodedName) return;
    try {
      const radio = await fetchArtistRadio(decodedName);
      if (!radio.tracks.length) {
        toast.info("Artist radio is not available yet");
        return;
      }

      const queue: Track[] = radio.tracks.map((track) => ({
        ...track,
        albumCover: track.albumCover || coverFallback,
      }));

      playAll(queue, 0, radio.source);
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
    playAll(queue, shuffle ? 0 : startIndex, { type: "queue", name: `${decodedName} Top Tracks` });
  }

  const similarArtists = info?.similar ?? [];
  const artistShowItems = buildArtistShowItems(showsData?.events ?? []);
  const albumsSorted = sortArtistAlbumsByYear(data?.albums ?? []);
  const previewTopTracks = (topTracks ?? []).slice(0, 5);
  const visibleShowItems = [...artistShowItems]
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 5);
  const artistHotNow = Boolean(
    topArtistsStats?.items?.some((item) => item.artist_name.toLowerCase() === decodedName.toLowerCase()),
  );

  async function handlePlayArtistSetlist() {
    try {
      const queue = await fetchPlayableSetlist(decodedName);
      if (!queue.length) {
        toast.info("No probable setlist tracks matched your library");
        return;
      }
      playAll(queue, 0, { type: "playlist", name: `${decodedName} Probable Setlist` });
      toast.success(`Playing probable setlist: ${queue.length} tracks`);
    } catch {
      toast.error("Failed to load probable setlist");
    }
  }

  useEffect(() => {
    if (!similarArtists.length) {
      setLocalSimilarArtists({});
      return;
    }

    let cancelled = false;
    const names = similarArtists.slice(0, 18).map((a) => a.name);

    api<Record<string, boolean>>("/api/artists/check-library", "POST", { names })
      .then((result) => {
        if (!cancelled) setLocalSimilarArtists(result);
      })
      .catch(() => {
        if (!cancelled) setLocalSimilarArtists({});
      });

    return () => { cancelled = true; };
  }, [similarArtists]);

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

  const photoUrl = buildArtistPhotoUrl(data.name);
  const tags = data.genres.length > 0 ? data.genres : (info?.tags ?? []);

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      <ArtistHeroSection
        artist={data}
        artistInfo={info ?? undefined}
        photoUrl={photoUrl}
        tags={tags}
        following={following}
        onPlay={() => handlePlayTopTracks()}
        onShuffle={() => handlePlayTopTracks(0, true)}
        onArtistRadio={() => void handleArtistRadio()}
        onToggleFollow={() => void toggleFollow()}
        onShare={() => void handleShare()}
        onOpenBio={() => setBioModalOpen(true)}
      />

      <div className="px-4 sm:px-6 pb-8 space-y-8">
        <ArtistTopTracksSection
          artistName={decodedName}
          tracks={previewTopTracks}
          coverFallback={coverFallback}
        />
        <ArtistAlbumsSection artistName={data.name} albums={albumsSorted} />
        <ArtistShowsSection
          shows={visibleShowItems}
          expandedShowId={expandedShowId}
          artistHotNow={artistHotNow}
          onToggleExpand={setExpandedShowId}
          onPlayProbableSetlist={() => void handlePlayArtistSetlist()}
        />
        <RelatedArtistsSection
          artists={similarArtists}
          localSimilarArtists={localSimilarArtists}
        />
      </div>

      <ArtistBioModal
        open={bioModalOpen}
        artist={data}
        artistInfo={info ?? undefined}
        photoUrl={photoUrl}
        tags={tags}
        onClose={() => setBioModalOpen(false)}
      />
    </div>
  );
}
