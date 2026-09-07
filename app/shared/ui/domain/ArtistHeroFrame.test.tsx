import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ArtistHeroFrame } from "./ArtistHeroFrame";
import { ArtistHeroPresentation } from "./ArtistHeroPresentation";

describe("ArtistHeroFrame", () => {
  it("integrates desktop artwork at the real image edges", () => {
    render(
      <ArtistHeroFrame
        composition="desktop"
        artwork={
          <img
            alt="Converge hero"
            src="/converge.webp"
            width="1480"
            height="600"
          />
        }
        artworkBounds={{ left: 0.3, top: 0, right: 0.8, bottom: 0.9 }}
      >
        <span>Converge</span>
      </ArtistHeroFrame>,
    );

    expect(screen.getByTestId("desktop-artist-hero-frame")).toHaveStyle({
      aspectRatio: "1480 / 600",
    });
    expect(screen.getByTestId("desktop-artist-hero-frame")).toHaveClass(
      "bg-surface-canvas",
    );
    expect(screen.getByTestId("desktop-hero-base")).toHaveStyle({
      background: "var(--surface-app)",
    });
    expect(screen.getByTestId("desktop-hero-artwork-mask")).toHaveStyle({
      maskImage: "none",
    });
    expect(screen.getByTestId("desktop-hero-left-edge-scrim")).toHaveStyle({
      left: "30%",
      width: "34%",
    });
    const rightScrim = screen.getByTestId("desktop-hero-right-scrim");
    expect(rightScrim).toHaveStyle({
      right: "calc(20% - 2px)",
      width: "calc(48% + 2px)",
    });
    expect(rightScrim.style.background).toContain("to left");
    expect(rightScrim.style.background).toContain("var(--surface-app) 0%");
    expect(rightScrim.style.background).toContain(
      "color-mix(in srgb, var(--surface-app) 96%, transparent) 8%",
    );
    expect(rightScrim.style.background).toContain("transparent 100%");
    expect(
      screen.queryByTestId("desktop-hero-right-surface-tail"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("desktop-hero-bottom-scrim")).toHaveStyle({
      bottom: "10%",
    });
    expect(screen.getByTestId("desktop-hero-bottom-scrim")).toHaveClass(
      "h-[58%]",
    );
    expect(screen.getByText("Converge")).toBeVisible();
  });

  it("uses a long bottom fade to integrate the mobile artboard", () => {
    render(
      <ArtistHeroFrame
        composition="mobile"
        artwork={
          <img
            alt="Converge mobile hero"
            src="/converge-mobile.webp"
            width="800"
            height="1000"
          />
        }
      />,
    );

    expect(screen.getByTestId("mobile-artist-hero-frame")).toHaveStyle({
      aspectRatio: "4 / 5",
    });
    expect(screen.getByTestId("mobile-hero-artwork-mask")).toHaveStyle({
      maskImage: "none",
    });
    expect(screen.getByTestId("mobile-hero-scrim")).toHaveClass("h-[82%]");
    expect(screen.queryByTestId("mobile-hero-side-scrim")).toBeNull();
    expect(
      screen.queryByTestId("mobile-hero-edge-scrim"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("desktop-hero-right-surface-tail"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("desktop-hero-left-scrim")).toBeNull();
    expect(screen.queryByTestId("desktop-hero-right-scrim")).toBeNull();
  });
});

describe("ArtistHeroPresentation", () => {
  it("uses the final desktop intro and copy positions", () => {
    render(
      <ArtistHeroPresentation
        composition="desktop"
        kicker="Just landed"
        artistName="Converge"
        intro={<span>Good afternoon</span>}
        actions={<span>Play artist</span>}
      />,
    );

    expect(screen.getByTestId("desktop-hero-presentation")).toHaveClass(
      "pointer-events-none",
    );
    expect(screen.getByTestId("desktop-hero-intro-layout")).toHaveClass(
      "pt-[92px]",
    );
    expect(screen.getByTestId("desktop-hero-copy-layer")).toHaveClass(
      "top-[39%]",
    );
    expect(screen.getByRole("heading", { name: "Converge" })).toHaveClass(
      "mt-1",
      "text-[52px]",
    );
  });

  it("uses the final mobile bottom position without desktop intro", () => {
    render(
      <ArtistHeroPresentation
        composition="mobile"
        kicker="Just landed"
        artistName="Converge"
        intro={<span>Good afternoon</span>}
        actions={<span>Play</span>}
        mobileIntroClassName="pt-[calc(var(--listen-mobile-header-height)+0.5rem)]"
      />,
    );

    expect(screen.queryByTestId("desktop-hero-intro-layout")).toBeNull();
    expect(screen.getByTestId("mobile-hero-intro-layout")).toHaveClass(
      "top-0",
      "px-5",
      "pt-[calc(var(--listen-mobile-header-height)+0.5rem)]",
    );
    expect(screen.getByText("Good afternoon")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-hero-copy-layout")).toHaveClass(
      "bottom-0",
      "px-5",
      "pb-10",
    );
  });
});
