import { Calendar, Play } from "lucide-react";
import { useNavigate } from "react-router";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { TrackRow } from "@/components/cards/TrackRow";
import {
  buildArtistAlbumCover,
  buildArtistPhotoUrl,
  type ArtistAlbum,
  type ArtistTopTrack,
} from "@/components/artist/artist-model";
import { groupByMonth, itemKey, UpcomingMonthGroup, type UpcomingItem } from "@/components/upcoming/UpcomingRows";
import { artistPagePath, artistTopTracksPath } from "@/lib/library-routes";

interface ArtistTopTracksSectionProps {
  artistId?: number;
  artistSlug?: string;
  tracks: ArtistTopTrack[];
  coverFallback?: string;
}

export function ArtistTopTracksSection({
  artistId,
  artistSlug,
  tracks,
  coverFallback,
}: ArtistTopTracksSectionProps) {
  const navigate = useNavigate();
  if (!tracks.length) return null;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-foreground">Top Tracks</h2>
        <button
          className="text-sm text-primary hover:underline"
          onClick={() => navigate(artistTopTracksPath({ artistId, artistSlug }))}
        >
          View all
        </button>
      </div>
      <div className="rounded-xl">
        {tracks.map((track, index) => (
          <TrackRow
            key={`${track.id}-${index}`}
            track={{
              id: track.id,
              title: track.title,
              artist: track.artist,
              album: track.album,
              duration: track.duration,
              path: track.id.includes("/") ? track.id : undefined,
            }}
            index={track.track || index + 1}
            showAlbum
            albumCover={track.album_id
              ? buildArtistAlbumCover(track.artist, track.album, track.album_id, track.album_slug)
              : coverFallback}
            showCoverThumb
          />
        ))}
      </div>
    </section>
  );
}

interface ArtistAlbumsSectionProps {
  artistName: string;
  albums: ArtistAlbum[];
}

export function ArtistAlbumsSection({ artistName, albums }: ArtistAlbumsSectionProps) {
  if (!albums.length) return null;

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-foreground">Albums</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {albums.map((album) => (
          <AlbumCard
            key={album.id}
            artist={artistName}
            album={album.display_name || album.name}
            albumId={album.id}
            albumSlug={album.slug}
            year={album.year?.slice(0, 4)}
            cover={buildArtistAlbumCover(artistName, album.name, album.id, album.slug)}
            layout="grid"
          />
        ))}
      </div>
    </section>
  );
}

interface ArtistShowsSectionProps {
  shows: UpcomingItem[];
  expandedShowId: string | null;
  artistHotNow: boolean;
  onToggleExpand: (showId: string | null) => void;
  onPlayProbableSetlist: () => void;
}

export function ArtistShowsSection({
  shows,
  expandedShowId,
  artistHotNow,
  onToggleExpand,
  onPlayProbableSetlist,
}: ArtistShowsSectionProps) {
  const nextAttendingShow = shows.find((item) => item.user_attending);
  if (!shows.length) return null;

  return (
    <section>
      <div className="mb-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">Shows</h2>
          {artistHotNow ? (
            <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-primary">
              Heavy rotation
            </div>
          ) : null}
        </div>

        {nextAttendingShow ? (
          <div className="rounded-[24px] border border-primary/15 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.14),transparent_40%),rgba(255,255,255,0.03)] p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
                  <Calendar size={12} />
                  Show prep
                </div>
                <h3 className="mt-3 text-xl font-bold text-foreground">{nextAttendingShow.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {nextAttendingShow.subtitle} ·{" "}
                  {new Date(`${nextAttendingShow.date}T12:00:00`).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
                <p className="mt-3 text-sm leading-6 text-white/70">
                  {nextAttendingShow.probable_setlist?.length
                    ? "You’re going to this show and we already have a probable setlist ready."
                    : "You’re going to this show. As soon as a probable setlist is available, this becomes an instant prep surface."}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {nextAttendingShow.probable_setlist?.length ? (
                  <button
                    onClick={onPlayProbableSetlist}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Play size={14} fill="currentColor" />
                    Play probable setlist
                  </button>
                ) : null}
                <button
                  onClick={() => onToggleExpand(itemKey(nextAttendingShow, 0))}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/65 transition-colors hover:border-white/20 hover:text-foreground"
                >
                  View show details
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        {groupByMonth(shows).map(([month, monthItems]) => (
          <UpcomingMonthGroup
            key={month}
            month={month}
            items={monthItems}
            expandedId={expandedShowId}
            onToggleExpand={onToggleExpand}
          />
        ))}
      </div>
    </section>
  );
}

interface RelatedArtistsSectionProps {
  artists: { name: string; match: number; id?: number; slug?: string }[];
}

export function RelatedArtistsSection({
  artists,
}: RelatedArtistsSectionProps) {
  if (!artists.length) return null;

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-foreground">Related Artists</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {artists.slice(0, 15).map((artist) => (
          <ArtistCard
            key={artist.id ?? artist.name}
            name={artist.name}
            artistId={artist.id}
            artistSlug={artist.slug}
            photo={artist.id ? buildArtistPhotoUrl(artist.name, artist.id, artist.slug) : undefined}
            subtitle={artist.match ? `${Math.round(artist.match * 100)}% match` : undefined}
            href={artist.id ? artistPagePath({ artistId: artist.id, artistSlug: artist.slug }) : `https://www.last.fm/music/${encodeURIComponent(artist.name)}`}
            external={!artist.id}
            large
            layout="grid"
          />
        ))}
      </div>
    </section>
  );
}
