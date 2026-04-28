import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ArtistChildRoute, LegacyArtistTopTracksRedirect } from "@/app-shell/LibraryRouteCompat";

vi.mock("@/pages/Album", () => ({
  Album: () => <div>Album page</div>,
}));

describe("LibraryRouteCompat", () => {
  it("redirects legacy artist detail URLs to the canonical artist slug route", async () => {
    renderRoute("/artists/52/quicksand", (
      <Routes>
        <Route path="/artists/:artistSlug/:albumSlug" element={<ArtistChildRoute />} />
        <Route path="/artists/:artistSlug" element={<div>Artist canonical page</div>} />
      </Routes>
    ));

    expect(await screen.findByText("Artist canonical page")).toBeTruthy();
  });

  it("renders the album page for nested artist/album slug URLs", async () => {
    renderRoute("/artists/quicksand/slip", (
      <Routes>
        <Route path="/artists/:artistSlug/:albumSlug" element={<ArtistChildRoute />} />
      </Routes>
    ));

    expect(await screen.findByText("Album page")).toBeTruthy();
  });

  it("redirects legacy artist top tracks URLs to the canonical slug route", async () => {
    renderRoute("/artists/52/quicksand/top-tracks", (
      <Routes>
        <Route path="/artists/:artistId/:legacySlug/top-tracks" element={<LegacyArtistTopTracksRedirect />} />
        <Route path="/artists/:artistSlug/top-tracks" element={<div>Artist top tracks page</div>} />
      </Routes>
    ));

    expect(await screen.findByText("Artist top tracks page")).toBeTruthy();
  });
});

function renderRoute(route: string, ui: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      {ui}
    </MemoryRouter>,
  );
}
