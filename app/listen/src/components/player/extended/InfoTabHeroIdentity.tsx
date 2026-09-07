import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import type { Track } from "@/contexts/player-types";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import type { TrackInfo } from "@/lib/track-info";

export function InfoTabHeroIdentity({
  info,
  currentTrack,
  audioSummary,
}: {
  info: TrackInfo;
  currentTrack: Track;
  audioSummary: string[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const artistName = info.artist || currentTrack.artist;
  const albumName = info.album || currentTrack.album;

  const openArtist = () =>
    navigate(
      currentTrack.globalArtistUid
        ? artistPagePath({
            artistId: currentTrack.artistId,
            globalArtistUid: currentTrack.globalArtistUid,
            artistSlug: currentTrack.artistSlug,
            artistName,
          })
        : artistPagePath({
            artistId: currentTrack.artistId,
            artistSlug: currentTrack.artistSlug,
            artistName,
          }),
    );

  const openAlbum = () =>
    navigate(
      currentTrack.globalAlbumUid
        ? albumPagePath({
            albumId: currentTrack.albumId,
            globalAlbumUid: currentTrack.globalAlbumUid,
            albumSlug: currentTrack.albumSlug,
            albumName,
            artistName,
          })
        : albumPagePath({
            albumId: currentTrack.albumId,
            albumSlug: currentTrack.albumSlug,
            albumName,
            artistName,
          }),
    );

  return (
    <div className="min-w-0 flex-1 pt-1">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">
        {t("player.info.nowInspecting")}
      </p>
      <h3 className="mt-1 text-xl font-semibold leading-tight text-text-primary text-balance">
        {info.title || currentTrack.title}
      </h3>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {currentTrack.globalArtistUid || currentTrack.artistId ? (
          <button
            type="button"
            aria-label={t("player.info.openArtist", { name: artistName })}
            onClick={openArtist}
            className="min-w-0 rounded-full border border-border-quiet bg-surface-quiet-subtle px-3 py-1 text-text-primary transition-colors hover:bg-surface-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/50"
          >
            <span className="block truncate">{artistName}</span>
          </button>
        ) : (
          <span className="truncate text-text-secondary">{artistName}</span>
        )}

        {albumName && (currentTrack.globalAlbumUid || currentTrack.albumId) ? (
          <button
            type="button"
            aria-label={t("player.info.openAlbum", { name: albumName })}
            onClick={openAlbum}
            className="min-w-0 rounded-full border border-border-quiet bg-surface-quiet-subtle px-3 py-1 text-text-secondary transition-colors hover:bg-surface-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/50"
          >
            <span className="block truncate">{albumName}</span>
          </button>
        ) : albumName ? (
          <span className="truncate text-text-muted">{albumName}</span>
        ) : null}
      </div>

      {audioSummary.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {audioSummary.map((item) => (
            <span
              key={item}
              className="info-tab-audio-pill rounded-full px-2.5 py-1 text-xs font-medium uppercase tracking-[0.14em] text-text-secondary"
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
