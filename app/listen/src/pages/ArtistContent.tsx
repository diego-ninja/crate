import { useState } from "react";

import { ArtistBioModal } from "@/components/artist/ArtistBioModal";
import { ArtistHeroSection } from "@/components/artist/ArtistHeroSection";
import { ArtistSetlistModal } from "@/components/artist/ArtistSetlistSection";
import {
  ArtistAlbumsSection,
  ArtistAppearsOnSection,
  ArtistShowsSection,
  ArtistTopTracksSection,
  RelatedArtistsSection,
} from "@/components/artist/ArtistPageSections";
import type { LoadedArtistPageController } from "@/pages/use-artist-page-controller";

export function ArtistContent({ page }: { page: LoadedArtistPageController }) {
  const [bioModalOpen, setBioModalOpen] = useState(false);
  const [setlistModalOpen, setSetlistModalOpen] = useState(false);
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);
  const {
    data,
    enrichment,
    canonicalPhotoUrl,
    photoUrl,
    backgroundUrl,
    tags,
    previewTopTracks,
    coverFallback,
    albumsSorted,
    appearsOn,
    visibleShowItems,
    similarArtists,
    artistHotNow,
  } = page.page;

  return (
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      <ArtistHeroSection
        artist={data}
        artistInfo={page.page.info}
        photoUrl={canonicalPhotoUrl || photoUrl}
        backgroundUrl={backgroundUrl || undefined}
        tags={tags}
        following={page.following}
        onPlay={() => page.handlePlayTopTracks()}
        onShuffle={() => page.handlePlayTopTracks(0, true)}
        onArtistRadio={() => void page.handleArtistRadio()}
        onPlaySetlist={() => setSetlistModalOpen(true)}
        hasSetlist={!!enrichment?.setlist?.probable_setlist?.length}
        onToggleFollow={() => void page.toggleFollow()}
        onShare={page.handleShare}
        onOpenBio={() => setBioModalOpen(true)}
      />

      <div className="mx-auto w-full max-w-[1480px] space-y-8 px-4 pb-8 sm:px-6">
        <ArtistTopTracksSection
          artistId={data.id}
          artistSlug={data.slug}
          tracks={previewTopTracks}
          coverFallback={coverFallback}
        />
        <ArtistAlbumsSection
          artistName={data.name}
          artistSlug={data.slug}
          albums={albumsSorted}
        />
        <ArtistAppearsOnSection playlists={appearsOn} />
        <ArtistShowsSection
          shows={visibleShowItems}
          expandedShowId={expandedShowId}
          artistHotNow={artistHotNow}
          onToggleExpand={setExpandedShowId}
          onPlayProbableSetlist={() => void page.handlePlayArtistSetlist()}
        />
        <RelatedArtistsSection artists={similarArtists} />
      </div>

      <ArtistBioModal
        open={bioModalOpen}
        artist={data}
        artistInfo={page.page.info}
        photoUrl={photoUrl}
        tags={tags}
        onClose={() => setBioModalOpen(false)}
      />
      {enrichment?.setlist?.probable_setlist?.length ? (
        <ArtistSetlistModal
          artistName={data.name}
          artistId={data.id}
          setlist={enrichment.setlist.probable_setlist}
          open={setlistModalOpen}
          onClose={() => setSetlistModalOpen(false)}
          onPlay={() => void page.handlePlayArtistSetlist()}
        />
      ) : null}
    </div>
  );
}
