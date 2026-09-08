import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { SearchResultsView } from "./ExploreSearchResults";

describe("SearchResultsView", () => {
  it("renders the empty search state when no result group has entries", () => {
    render(
      <SearchResultsView results={{ artists: [], albums: [], tracks: [] }} />,
    );

    expect(screen.getByText("explore.search.noResults")).toBeInTheDocument();
  });
});
