import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Play } from "@crate/ui/icons";
import { useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { CrateLoader } from "@/components/ui/CrateLoader";
import {
  buildArtistPlayerTrack,
  topTrackToTrackRowData,
  type ArtistTopTrack,
} from "@/components/artist/artist-model";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import {
  albumCoverApiUrl,
  artistApiPath,
  artistPagePath,
  artistPhotoApiUrl,
  artistTopTracksPath,
} from "@/lib/library-routes";

function toPlayerTracks(tracks: ArtistTopTrack[]): Track[] {
  return tracks.map((track) =>
    buildArtistPlayerTrack(
      track,
      track.artist,
      artistPhotoApiUrl(
        {
          artistId: track.artist_id,
          artistEntityUid: track.artist_entity_uid,
          artistSlug: track.artist_slug,
          artistName: track.artist,
        },
        { size: 512 },
      ),
    ),
  );
}

export function ArtistTopTracks() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { artistSlug: routeArtistSlug } = useParams<{ artistSlug?: string }>();
  const { playAll } = usePlayerActions();
  const { data: artist } = useApi<{ id?: number; slug?: string; name: string }>(
    routeArtistSlug ? artistApiPath({ artistSlug: routeArtistSlug }) : null,
    "GET",
    undefined,
    { safetyNetMs: 120_000 },
  );
  const artistName = artist?.name || "";
  const { data: topTracks, loading } = useApi<ArtistTopTrack[]>(
    routeArtistSlug
      ? `/api/artist-slugs/${encodeURIComponent(
          routeArtistSlug,
        )}/top-tracks?count=50`
      : null,
    "GET",
    undefined,
    { safetyNetMs: 120_000 },
  );

  useEffect(() => {
    if (!artist?.name) return;
    const canonicalPath = artistTopTracksPath({
      artistId: artist.id,
      artistSlug: artist.slug,
      artistName: artist.name,
    });
    if (location.pathname !== canonicalPath) {
      navigate(canonicalPath, { replace: true });
    }
  }, [artist?.id, artist?.name, artist?.slug, location.pathname, navigate]);

  function handlePlayAll() {
    const queue = toPlayerTracks(topTracks || []);
    if (!queue.length) {
      toast.info(t("actions.artist.toasts.noTopTracks"));
      return;
    }
    playAll(queue, 0, {
      type: "queue",
      name: t("actions.artist.topTracksSource", { name: artistName }),
    });
  }

  const trackRows = useMemo<TrackRowData[]>(
    () => (topTracks || []).map((track) => topTrackToTrackRowData(track)),
    [topTracks],
  );

  if (loading) {
    return <CrateLoader label={t("artist.topTracks.loading")} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() =>
              navigate(
                artistPagePath({
                  artistId: artist?.id,
                  artistSlug: artist?.slug,
                  artistName,
                }),
              )
            }
            className="flex size-10 items-center justify-center rounded-full border border-border-quiet text-text-primary/70 transition-colors hover:bg-text-primary/5 hover:text-text-primary"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">
              {artistName}
            </h1>
            <p className="text-sm text-text-muted">
              {t("artist.sections.topTracks")}
            </p>
          </div>
        </div>

        <button
          className="flex items-center gap-2 rounded-lg bg-accent-action px-5 py-2.5 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90"
          onClick={handlePlayAll}
        >
          <Play size={15} fill="currentColor" />
          {t("player.play")}
        </button>
      </div>

      <div className="rounded-xl border border-text-primary/5 bg-text-primary/[0.02]">
        {(topTracks || []).map((track, index) => (
          <TrackRow
            key={
              track.id ??
              track.global_track_uid ??
              track.track_entity_uid ??
              track.library_track_id ??
              [track.artist, track.album, track.title].join(":")
            }
            track={trackRows[index]!}
            index={track.track || index + 1}
            showAlbum
            albumCover={
              track.artist && track.album
                ? albumCoverApiUrl(
                    {
                      albumId: track.album_id,
                      albumEntityUid: track.album_entity_uid,
                      globalAlbumUid: track.global_album_uid,
                      artistEntityUid: track.artist_entity_uid,
                      albumSlug: track.album_slug,
                      artistName: track.artist,
                      albumName: track.album,
                    },
                    { size: 128 },
                  )
                : artistPhotoApiUrl(
                    {
                      artistId: track.artist_id,
                      artistEntityUid: track.artist_entity_uid,
                      artistSlug: track.artist_slug,
                      artistName: track.artist,
                    },
                    { size: 128 },
                  )
            }
            showCoverThumb
            queueTracks={trackRows}
          />
        ))}
      </div>
    </div>
  );
}
