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
import { shuffleArray } from "@/lib/utils";
import { artistApiPath, artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

export function Artist() {
  const { artistId: artistIdParam } = useParams<{ artistId?: string }>();
  const artistId = artistIdParam ? Number(artistIdParam) : undefined;
  const [bioModalOpen, setBioModalOpen] = useState(false);
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const { playAll } = usePlayerActions();

  const { data, loading, error } = useApi<ArtistData>(
    artistId != null ? artistApiPath({ artistId }) : null,
  );

  useEffect(() => {
    if (!data?.id) return;
    api<{ following: boolean }>(`/api/me/follows/artists/${data.id}`)
      .then((d) => setFollowing(d.following))
      .catch(() => {});
  }, [data?.id]);

  async function toggleFollow() {
    if (!data?.id) return;
    try {
      if (following) {
        await api(`/api/me/follows/artists/${data.id}`, "DELETE");
        setFollowing(false);
        toast.success(`Unfollowed ${data.name}`);
      } else {
        await api(`/api/me/follows/artists/${data.id}`, "POST");
        setFollowing(true);
        toast.success(`Following ${data.name}`);
      }
    } catch {
      toast.error("Failed to update follow status");
    }
  }

  async function handleShare() {
    if (!data?.id) return;
    const shareUrl = `${window.location.origin}${artistPagePath({
      artistId: data.id,
      artistSlug: data.slug,
    })}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: data.name, text: data.name, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Artist link copied");
      }
    } catch {
      toast.error("Failed to share artist");
    }
  }
  const { data: info } = useApi<ArtistInfo>(
    artistId != null ? `/api/artists/${artistId}/info` : null,
  );
  const { data: topTracks } = useApi<ArtistTopTrack[]>(
    artistId != null ? `/api/navidrome/artists/${artistId}/top-tracks?count=12` : null,
  );
  const { data: showsData } = useApi<{ events: ArtistShowEvent[] }>(
    artistId != null ? `/api/artists/${artistId}/shows?limit=12` : null,
  );
  const { data: topArtistsStats } = useApi<StatsListResponse<StatsArtist>>(
    artistId != null ? "/api/me/stats/top-artists?window=30d&limit=12" : null,
  );

  const coverFallback = data?.albums?.[0]
    ? buildArtistAlbumCover(data.name, data.albums[0]!.name, data.albums[0]!.id, data.albums[0]!.slug)
    : undefined;

  const playerTracks = useMemo<Track[]>(() => {
    if (!topTracks?.length) return [];
    return topTracks.map((track) => buildArtistPlayerTrack(track, data?.name || "", coverFallback));
  }, [coverFallback, data?.name, topTracks]);

  async function handleArtistRadio() {
    const currentArtistId = data?.id;
    if (currentArtistId == null || !data?.name) return;
    try {
      const radio = await fetchArtistRadio(currentArtistId, data.name);
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
    playAll(queue, shuffle ? 0 : startIndex, { type: "queue", name: `${data?.name || "Artist"} Top Tracks` });
  }

  const similarArtists = info?.similar ?? [];
  const artistShowItems = buildArtistShowItems(showsData?.events ?? []);
  const albumsSorted = sortArtistAlbumsByYear(data?.albums ?? []);
  const previewTopTracks = (topTracks ?? []).slice(0, 5);
  const visibleShowItems = [...artistShowItems]
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 5);
  const artistHotNow = Boolean(
    data?.id && topArtistsStats?.items?.some((item) => item.artist_id === data.id),
  );

  async function handlePlayArtistSetlist() {
    try {
      if (!data?.id) return;
      const queue = await fetchPlayableSetlist({ artistId: data.id, artistName: data.name });
      if (!queue.length) {
        toast.info("No probable setlist tracks matched your library");
        return;
      }
      playAll(queue, 0, { type: "playlist", name: `${data.name} Probable Setlist` });
      toast.success(`Playing probable setlist: ${queue.length} tracks`);
    } catch {
      toast.error("Failed to load probable setlist");
    }
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

  const photoUrl = buildArtistPhotoUrl(data.name, data.id, data.slug);
  const canonicalPhotoUrl = artistPhotoApiUrl({ artistId: data.id, artistSlug: data.slug, artistName: data.name });
  const tags = data.genres.length > 0 ? data.genres : (info?.tags ?? []);

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      <ArtistHeroSection
        artist={data}
        artistInfo={info ?? undefined}
        photoUrl={canonicalPhotoUrl || photoUrl}
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
          artistId={data.id}
          artistSlug={data.slug}
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
