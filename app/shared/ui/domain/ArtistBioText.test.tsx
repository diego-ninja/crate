import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ArtistBioText, truncateArtistBio } from "./ArtistBioText";

describe("ArtistBioText", () => {
  it("renders only http links and keeps punctuation outside the anchor", () => {
    render(
      <ArtistBioText
        text={"Official https://example.com/band. www.example.org!"}
      />,
    );

    expect(
      screen.getByRole("link", { name: "https://example.com/band" }),
    ).toHaveAttribute("href", "https://example.com/band");
    expect(
      screen.getByRole("link", { name: "www.example.org" }),
    ).toHaveAttribute("href", "https://www.example.org");
  });

  it("truncates collapsed bios predictably", () => {
    expect(truncateArtistBio("123456789", 5)).toBe("12345…");
    expect(truncateArtistBio("short", 10)).toBe("short");
    expect(truncateArtistBio("Bio https://example.com/long", 12)).toBe("Bio…");
  });
});
