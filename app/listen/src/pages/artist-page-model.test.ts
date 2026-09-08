import { describe, expect, it } from "vitest";

import type { ArtistPageData } from "@/components/artist/artist-model";
import {
  buildArtistCanonicalPath,
  buildArtistPageViewModel,
  buildArtistRequestPath,
} from "@/pages/artist-page-model";

const pageData: ArtistPageData = {
  artist: {
    id: 7,
    entity_uid: "artist-entity-7",
    global_artist_uid: "artist-global-7",
    slug: "converge",
    name: "Converge",
    albums: [],
    total_tracks: 1,
    total_size_mb: 42,
    primary_format: "FLAC",
    genres: ["Hardcore"],
    issue_count: 0,
  },
  info: {
    bio: "",
    tags: ["Metal"],
    similar: [],
    listeners: 0,
    playcount: 0,
    image_url: null,
    url: "",
  },
  top_tracks: [
    {
      id: "track-1",
      title: "Dark Horse",
      artist: "Converge",
      album: "Axe to Fall",
      duration: 120,
      track: 1,
    },
  ],
  shows: { events: [], configured: true, source: "setlist.fm" },
  appears_on: [],
  enrichment: {},
  artist_hot_rank: null,
};

describe("artist page model", () => {
  it("builds API paths for global and slug routes", () => {
    expect(buildArtistRequestPath("artist-global-7", undefined)).toBe(
      "/api/catalog/artists/artist-global-7/page",
    );
    expect(buildArtistRequestPath(null, "converge")).toBe(
      "/api/artist-slugs/converge/page?top_tracks_count=50",
    );
  });

  it("derives the canonical public path from the loaded artist", () => {
    expect(buildArtistCanonicalPath(pageData.artist, null)).toBe(
      "/artists/converge",
    );
  });

  it("keeps page presentation derivation in one stable model", () => {
    const view = buildArtistPageViewModel(pageData, null);

    expect(view).toMatchObject({
      currentGlobalArtistUid: "artist-global-7",
      artistHotNow: false,
      tags: ["Hardcore"],
      previewTopTracks: pageData.top_tracks,
      visibleShowItems: [],
      canonicalPath: "/artists/converge",
    });
    expect(view.playerTracks).toHaveLength(1);
    expect(view.playerTracks[0]).toMatchObject({
      id: "track-1",
      artist: "Converge",
    });
  });
});
