import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ArtistBioProfile } from "./ArtistBioProfile";

describe("ArtistBioProfile", () => {
  it("renders the full multi-paragraph bio and grouped member tables", () => {
    render(
      <ArtistBioProfile
        artistName="Denzel Curry"
        bio={"First paragraph.\n\nSecond paragraph."}
        bioExpanded
        libraryStats={{ albums: 4, tracks: 42, sizeMb: 128 }}
        members={[
          { name: "Current Member", roles: ["vocals"], begin: "2020" },
          {
            name: "Former Member",
            roles: ["guitar"],
            begin: "2015",
            end: "2019",
          },
        ]}
      />,
    );

    expect(screen.getByText("First paragraph.")).toBeInTheDocument();
    expect(screen.getByText("Second paragraph.")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("128 MB")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Current members" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Former members" }),
    ).toBeInTheDocument();
  });
});
